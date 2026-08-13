# 0015: Give the bull/bear agents extended thinking, and don't try to surface the judge's

## Context

Auditing what the web UI renders against what Supabase stores turned up a response shape nobody
had looked at: 44 of 244 stored bull/bear calls contain **more than one text block**, each a
complete `stockAnalysisSchema` object.

The cause is structural. `web_search` is a server-side tool, so Anthropic executes it
mid-generation and splices results back into the same response without ever returning to host
code. Emitted text is immutable, and `output_config.format` constrains every text token to the
schema — so when the model wants another search after already answering, it cannot amend its
answer and cannot write a scratchpad note. Restating the whole object is the only move the API
shape leaves it. Bull/bear had no `thinking` block (0 of 244 calls), so the JSON was their only
output channel.

16 of those 44 had a *successful* search between drafts, meaning the two drafts differ and the
judge was reading analysis formed before the model's last piece of evidence — `parseWithRetry`
took the **first** text block. The other 28 followed a search rejected with `max_uses_exceeded`
and were re-emitted verbatim: pure wasted output tokens.

Fixing the parse to `findLast` (commit `e07f66c`) addresses the symptom. This decision addresses
the cause.

## Options considered

**Bull/bear reasoning channel**
1. Leave as-is, rely on `findLast`. Free, but the model keeps burning output tokens on duplicate
   drafts, and every redraft is a coin-flip about which evidence it reflects.
2. Extended thinking (`{type: 'enabled', budget_tokens: 2048}`). Gives deliberation its own
   channel so one final object is emitted. Costs thinking tokens, billed as output.
3. Drop structured output for bull/bear and parse free text. Removes the constraint but throws
   away schema guarantees and reintroduces the parsing fragility `parseWithRetry` exists for.

Adaptive thinking (`{type: 'adaptive'}`) and `output_config.effort` are not options here: both
error on Haiku 4.5, which predates them. The budgeted form is the only one available.

**Judge reasoning visibility**
1. `thinking: {display: 'summarized'}` on the Opus 5 judge, to capture why it picks nothing on
   roughly a third of runs.
2. A `noPickReason` field in `stockPickSchema`, forcing the model to state it in its output.

## Decision

**Option 2 for bull/bear** — extended thinking at `budget_tokens: 2048`, against
`MAX_TOKENS = 4096`. `parseWithRetry` now echoes the full `response.content` on retry rather than
bare text, since signed thinking blocks must replay unmodified.

Verified live before merging, on a real HYLN prompt: bull and bear each returned **one** text
block, with thinking interleaved between searches (bear ran three searches across three thinking
blocks and still emitted a single answer). Thinking came back readable — 2,467 and 6,122
characters.

**Neither option for the judge, for now.** `display: "summarized"` is documented to work on
Opus 5 and does not: it returns an empty thinking block against this API key. Ruled out the
request shape, the SDK (raw `fetch` reproduces it), the model (Opus 4.8 fails on the docs' own
verbatim example), the credential type (standard API key, not a subscription token), and
streaming. Reported to Anthropic support 2026-08-13. Option 2 remains the real fix and is
tracked in BACKLOG.md — a summary was never a commitment anyway.

## Trade-off

Thinking tokens bill as output, so bull/bear output roughly doubles-to-triples: ~780 tokens per
call today against 1,743 (bull) and 2,680 (bear) in testing, about **+$0.005–0.010 per call**, or
~$0.15/day at 20 calls. We accept that for one authoritative draft per call instead of two-plus of
uncertain provenance, and it partly offsets itself — the 28 verbatim redrafts were already
spending ~700–900 output tokens each on nothing.

Latency is the residual risk. Thinking adds time to calls that already run up to three searches,
and `TIMEOUT` is 180s per call; a timeout fails that ticker to `research_failed`. Watch the first
few runs, and drop `budget_tokens` before dropping the search budget if calls start timing out.

Note this lands alongside the first production run of `max_uses: 3` (see BACKLOG.md), which moves
cost and latency considerably more than thinking does. If the next run looks expensive or slow,
attribute it there first.
