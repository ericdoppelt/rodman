# 0013: Use Alpaca's Market Data API for intraday pick-chart bars

## Context

Pick charts (`web/src/components/PickChart.tsx`) never showed the current trading session until
after close. Verified 2026-08-03: a live call to Massive/Polygon's
`/v2/aggs/ticker/{ticker}/range/1/hour/...` mid-session (12:25pm ET, AAPL) returned zero bars for
the current day — last bar was Friday's close, response marked `status: "DELAYED"`. Massive's free
"Stocks Basic" plan is end-of-day only; the advertised 15-min-delayed intraday data requires the
paid "Stocks Starter" tier ($29/mo). The 30-min refresh cadence
(`.github/workflows/update-price-series.yml`) was pointless during market hours as a result —
nothing new to fetch until the current day's bars finalized shortly after close.

## Options considered

1. Accept EOD-only charts, cut the intraday cron down to one run after close. Zero cost, zero
   new integration, but charts genuinely don't move intraday.
2. Find another free intraday source and swap it in for same-day bars.
3. Pay for Massive's Stocks Starter tier ($29/mo) for 15-min-delayed intraday data. Simplest
   technically (same provider), but violates the project's default preference for free options.

## Decision

Option 2 — swap `updatePickPriceSeries.ts`'s bar source from Massive/Polygon to Alpaca's Market
Data API (`GET /v2/stocks/{symbol}/bars`, `feed=iex`).

Alpaca was already integrated for paper-trade execution
(`docs/decisions/0012-alpaca-paper-trading-execution.md`), so this reuses the existing
`ALPACA_API_KEY`/`ALPACA_API_SECRET` (already in `.env.example` and both workflows' GitHub
secrets) — no new provider signup, no new secret plumbing. Its free tier grants the IEX feed,
which is real-time (not delayed) and free with no card on file, satisfying the project's cost
preference. Its rate limit (200 calls/min) is also far more headroom than Polygon's free 5/min,
so the per-call throttle (`rateLimit.ts`'s `polygonRequest`) is no longer needed for this script.

Massive/Polygon stays as-is everywhere else (`fetchTopDips.ts`, the backtest harness) — those only
ever need end-of-day or historical data, where Massive's free tier is already sufficient.

## Trade-off

IEX is a single exchange (~2-3% of consolidated U.S. equity volume), not the full SIP tape, so
bars can diverge slightly from the "real" composite price, especially for thinly-traded names.
Acceptable for a display chart; would not be acceptable if this feed were ever used for execution
decisions (paper-trade orders already go through Alpaca's own order-placement endpoint, which
prices at fill time independent of this feed).
