# 0007. Tavily for backtest evidence, plus a per-day raw-input cache

## Context

The backtest's bull/bear research used Polygon's `/v2/reference/news` endpoint
(`published_utc.lte`-filtered) as a point-in-time-safe stand-in for production's live
`web_search` tool. That kept the backtest leakage-free, but Polygon's news feed is much
thinner than a real web search — it only ever validated the judge's conviction-calibration
logic against thin evidence, not whether richer research would change picks.

Claude's `web_search` tool has no server-enforced date-restriction parameter — only
`max_uses`, `allowed_domains`, `blocked_domains`, `user_location`, `allowed_callers`,
`response_inclusion` (confirmed against current docs, 2026-07-30). Steering the query text
itself with a `before:`-style operator is a soft, unenforced instruction with no guarantee
the underlying index honors it.

Separately, every backtest run re-fetched the same Polygon/news data from scratch for every
sampled date, even across reruns testing a different model — most of the ~20-25 minute setup
time is identical, deterministic work.

## Options considered

**Evidence source:**
1. Keep Polygon news only — cheapest, but thin evidence, already a known limitation.
2. `before:` operator in the `web_search` query text — no server-side guarantee, rejected.
3. A third-party search API with a real, server-enforced date-range parameter (Tavily,
   Brave) — richer than Polygon's news feed, still genuinely leakage-safe.

**Caching:**
1. No caching — simplest, but re-pays the full data-gathering cost on every model comparison.
2. Cache raw inputs (candidates, index/sector data, news) per date, regenerate bull/bear/judge
   fresh every run.
3. Cache bull/bear outputs too — rejected: that would fix the research and only let the judge
   vary, defeating the point of testing different bull/bear models.

## Decision

- Replace Polygon news with **Tavily** (`src/backtest/fetchTavily.ts`) for both per-ticker
  and general market news, using Tavily's `end_date` parameter (`topic: 'news'` for
  `published_date` metadata). Free tier: 1,000 credits/month, no credit card required (see
  `CLAUDE.md` — free options preferred for new data sources).
- Add a per-date raw-input cache (`src/backtest/dailyCache.ts`,
  `data/backtest-cache/{date}.json`, gitignored) storing dip candidates, the day's index/sector
  snapshot, and news (market + per-ticker). Checked before any Polygon/Tavily call in
  `runBacktest.ts`'s main loop. Bull/bear/judge always regenerate fresh from the cached (or
  freshly fetched) raw inputs.

## Verification

Empirically tested (2026-07-30) rather than trusted from docs alone: `end_date` alone is
**silently ignored** by Tavily's `/search` endpoint — a request with only `end_date` set
returned results dated months after the cutoff. The fix (now in `fetchTavily.ts`) is to always
pass a wide-open `start_date` (`2000-01-01`) alongside `end_date`; with both set, the range is
correctly enforced (confirmed against `AAPL stock` queries — zero results after cutoff across
repeated tests). This is undocumented behavior, not mentioned anywhere in Tavily's API
reference — worth re-checking if Tavily ships an API version change.

## Trade-off

Tavily is still not live web search — narrower index, and the model-pretraining-leakage risk
(the model may already know how a historical date played out, independent of retrieved
evidence) remains unsolved regardless of evidence source. The cache only pays off across
reruns of the *same* sampled dates (same `RANDOM_SEED`/`LOOKBACK_WINDOW_DAYS`); changing those
parameters invalidates the cache's usefulness for that run, though stale entries are harmless
(just unused) rather than actively wrong, since nothing is cached that could change after the
fact — all cached data is itself point-in-time (published on or before the test date).
