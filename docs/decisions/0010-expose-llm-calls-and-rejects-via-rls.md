# 0010: Expose llm_calls and rejected_candidates via RLS

## Context

Adding a per-day "process flow chart" page (market context → bull/bear cases per
candidate → judge decision). The data already exists in `llm_calls` and
`rejected_candidates`, but current RLS policies give the anon/authenticated
role zero access to either table — only `runs`, `picks`, and
`pick_price_series` are public.

## Options considered

1. **Add RLS read policies** scoped to completed runs (mirrors the existing
   pattern used for `picks`/`pick_price_series`). Simple, reuses the existing
   `runs.status = 'completed'` gating.
2. **Server endpoint with service role**, returning a curated/redacted shape
   so raw prompts aren't publicly queryable.

## Decision

Option 1. The tables contain no PII or credentials — just prompts, model
responses, and reasoning about public market data — so there's nothing to
redact. Cost and reasoning are already surfaced in the UI today.

## Trade-off

Full system/user prompts (i.e. prompt engineering) become publicly visible
via the anon key. Acceptable for a personal project; would need revisiting
if the prompts ever contain anything sensitive or if prompt IP becomes a
concern.
