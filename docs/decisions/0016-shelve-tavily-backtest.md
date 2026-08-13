# 0016 — Shelve the Tavily backtest, keep the harness

## Context

`pnpm backtest` scores the judge against historical dates. It cannot use production's live
`web_search`, which has no server-enforced date restriction and would leak future information into
a historical run, so `docs/decisions/0007` chose Tavily for its `end_date` filter instead.

`BACKLOG.md` had already flagged that Tavily's evidence looked poor — TDTH returned articles about
unrelated microcaps, BULL returned generic "bull market" commentary, and a good match (CAVA) came
back dated 4-8 months before the dip. It proposed a five-part fix: qualify queries with the company
name, switch `topic` to `'finance'`, use `search_depth: 'advanced'`, narrow the `start_date` window,
and consider `include_raw_content`.

Items 1-4 were implemented. Then, before spending on a run, the evidence was measured directly:
50 of the 100 candidates in a real sample, two query shapes, ~100 Tavily calls, no Claude.

| | name only | name+ticker+stock |
|---|---|---|
| Articles returned | 217 | 205 |
| Empty queries | 0 / 50 | 0 / 50 |
| On-topic | 34% | 40% |
| On-topic and published within 7 days | 11% | **16%** |
| On-topic and published same day | 2% | 3% |

On-topic is detected by title match, so these are floors rather than exact rates.

Three findings mattered:

- **16%.** Of five articles handed to each bull/bear agent, roughly 0.8 are both about the company
  and recent enough to explain that day's drop.
- **Zero empty results, ever.** Tavily returned articles for all 50 stocks under both query shapes.
  It never signals "I have nothing," so the agents always receive five confident-looking articles
  whether or not real news exists, and cannot distinguish the two cases.
- **The query wasn't the problem.** The hypothesis that appending "stock" invited generic market
  articles was wrong — the fuller query scored better on every measure. No query shape tested rescued
  the poorly-covered tickers.

`topic: 'finance'` was also reverted. It returns no `published_date` at all, silently collapsing every
article's date to the cutoff, and returns nothing for the generic query the market-context block is
built from.

## Options considered

1. **Delete the backtest.** Honest about the fact that it can't currently work, but throws away
   sampling, caching, forward returns, scoring, and the contamination guards — none of which are
   Tavily's fault.
2. **Leave it as-is.** Zero work, but the harness still runs and still prints a confident-looking
   number. The most recent recorded result (5-day: picks -0.56% vs. baseline +2.03%) was produced on
   evidence now known to be mostly noise, and nothing in the output says so.
3. **Shelve it: keep the harness, gate the entrypoint, write down why.** More work than (2), and
   leaves dormant code in the tree that has to be understood by anyone reading it.

## Decision

Option 3. The evidence source is shelved; the harness is kept.

The Tavily-specific surface is two files — `fetchTavily.ts` and `fetchHistoricalNews.ts` — and
`researchStockChangesBacktest` already takes `newsLookup` as an injected parameter. Swapping in a
better point-in-time news source is a one-function change, so the barrier to reviving this is low
and worth preserving.

`pnpm backtest` now requires `BACKTEST_ACKNOWLEDGE_EVIDENCE=1` to run, so a number can't be produced
without the operator having seen this file.

`scripts/measureTavilyRelevance.ts` is kept as a **provider acceptance test**. Any candidate
historical-news source gets pointed at it, and 16% on-topic-within-7-days is the bar to beat. That
turns "is this source good enough?" from a judgment call into a measurement.

Validation moves to the forward test (`BACKLOG.md` track 2): production runs use live `web_search`,
which was measured at 100% coverage with specific, well-sourced evidence. It accumulates one run per
weekday and needs no historical news provider at all.

## Trade-off

Shelving costs the ability to evaluate a judge or prompt change against a year of history. The
forward test replaces it only slowly — one run per weekday, and the earliest production run is
2026-07-29 — so questions like "would this prompt have done better?" have no fast answer for months.

Accepted because the alternative is worse: a fast answer computed from articles about the wrong
companies is not a cheaper version of the truth, it is a confident wrong number. The judge-replay
harness (re-running alternative judges against the real bull/bear analyses already stored in
`llm_calls`) recovers part of what is lost, on evidence that is actually about the right companies.
