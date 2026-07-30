# 0004: Point-in-time market context for the backtest, built from raw facts

## Context

The backtest passed bull/bear a placeholder string instead of any macro-conditions text — production researches live market context via `web_search` (`src/fetchMarketContext.ts`), but that call can't be restricted to a historical date, so the backtest omitted it entirely rather than leak post-date information. In practice this meant bull/bear never saw "the market sold off broadly that day" / "tech was down while energy was up" / "a Fed meeting was upcoming" — a real gap versus what production's judge sees.

## Options considered

- **AI-written narrative summary** — mirror production's `fetchMarketContext.ts` shape: fetch general market news (point-in-time filtered, same `published_utc.lte` mechanism as the existing per-ticker news) and have a Haiku call write a short paragraph summarizing it.
- **Raw structured facts, no narrative** — compute index/sector price moves from the day's already-fetched grouped-daily data (zero extra API calls) and hand bull/bear real retrieved headlines directly as bullet excerpts, with no summarization step in between.

The narrative option has a leakage risk the `published_utc.lte` filter doesn't cover: prompting a model to "summarize what happened on this date" invites it to draw on what it already knows from pretraining about well-covered macro events (Fed decisions, broad selloffs, major index moves), independent of what the retrieved news snippets actually say. That risk exists to a lesser degree in the per-ticker bull/bear research too (mitigated there by "use only the information above"), but is much stronger for macro events specifically, since they're the most heavily-documented, most-likely-memorized class of financial news.

## Decision

Raw facts, no synthesis step (`src/backtest/marketContext.ts`):
- **Index/sector snapshot** — SPY/QQQ/DIA plus the 11 sector SPDRs, percentage change computed directly from the day's grouped-daily Polygon pull (`getLargestStockDips` now also returns `allResults`, the full unfiltered day's data, so no extra call is needed).
- **Real headlines** — Polygon's general news endpoint (no ticker filter), `published_utc.lte`-restricted like the existing per-ticker news, pulled at a higher limit (20 headlines vs. the 5 used per-ticker) so multiple storylines can show up. Handed to bull/bear as raw excerpts, same pattern as the existing ticker-news block.

Bull/bear read this material themselves and reason over it — there's no intermediate "tell me what happened" call whose output can't be traced back to a specific retrieved source.

## Trade-off

The result reads as numbers + headline bullets, not the polished prose an AI summary (or production's live search) would produce. In exchange, every word of the market-context block is traceable to something that was actually retrieved and dated before the test day — nothing in it can be the model reciting memorized history. If richer prose is wanted later, an AI-summarization pass could be added on top of these same retrieved facts (with an explicit "use only the material below" instruction), rather than replacing them.
