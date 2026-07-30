# 0003: Static market-cap snapshot for the backtest, live lookup stays in production

## Context

`getLargestStockDips` (`src/fetchTopDips.ts`) filters dip candidates by market cap via `_fetchMarketCap`, which calls Polygon's per-ticker reference endpoint, rate-limited to 1 call/12s (`src/rateLimit.ts`). In the backtest (`src/backtest/runBacktest.ts`), this scans several candidates per test day, pushing each successful day to ~5.5–6 min and a 30-day run to 2–3 hours — the dominant cost of running `pnpm backtest`.

Polygon's endpoint only ever returns *today's* market cap regardless of the date requested, so for the backtest's historical test dates it was never more accurate than a slightly-stale snapshot to begin with — just slower. A static ticker→market-cap table removes the rate-limited scan entirely with no accuracy cost for that use case.

## Options considered

- **Static snapshot everywhere** — replace `_fetchMarketCap` outright, in both the backtest and production (`src/index.ts`). Simplest: one code path. But production's filter runs against *today's* dips for real trading decisions, where the live call is cheap (one scan/day) and does return current data — a snapshot up to a week old would be a real (if probably small) accuracy regression there.
- **Static snapshot for the backtest only** — inject the market-cap lookup into `getLargestStockDips` (defaulting to the existing live `_fetchMarketCap`), and have only the backtest pass a static-snapshot-backed lookup. Production is untouched.

## Decision

Static snapshot for the backtest only. `getLargestStockDips` takes an optional `marketCapLookup` parameter (default: live Polygon call). `runBacktest.ts` passes `staticMarketCapLookup` (`src/backtest/staticMarketCap.ts`), which reads `src/data/market-caps.csv` into an in-memory `Map` on first use. Production's call site is unchanged and keeps the live, rate-limited lookup.

The snapshot itself comes from Nasdaq's public stock-screener endpoint (`scripts/updateMarketCapSnapshot.ts`, run via `pnpm update-market-caps`), which returns market cap for every listed ticker in one request — no per-ticker calls, no rate limit.

## Trade-off

Backtest runs are now bottlenecked by Polygon's grouped-daily and news endpoints only, not the market-cap scan — a 30-day run drops from ~2–3 hours toward the ~60s/day baseline. The snapshot needs periodic manual refresh (`pnpm update-market-caps`) to avoid drifting too far from current caps; if production ever needs the same speed-up, this decision would need revisiting since a stale snapshot is a real accuracy trade for live trading decisions in a way it isn't for historical backtest dates.
