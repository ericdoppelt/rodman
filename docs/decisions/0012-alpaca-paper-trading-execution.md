# 0012: Execute picks as Alpaca paper trades, fixed $20 notional, fully automatic

## Context

`docs/research/alpaca-vs-robinhood-mcp.md` established Alpaca as the only broker that fits this
pipeline's unattended GitHub Actions cron (plain API-key auth, no browser OAuth). BACKLOG.md
flagged two open questions before wiring any execution: paper vs. live money, and position sizing
(there was none). This decision resolves both, scoped to a first working integration.

## Options considered

**Paper vs. live**
1. Paper trading (Alpaca's free simulated account, fake ~$100k balance, no funding). Zero
   financial risk; validates order-placement plumbing against real daily picks.
2. Live trading. Requires a funded, verified brokerage account and puts real capital at risk
   before the execution code has ever run once.

**Position sizing**
1. Fixed dollar amount per pick.
2. Conviction-scaled (size varies with the judge's conviction level).
3. Wire up order placement only; size entered manually per trade.

**Trigger mode**
1. Manual approval per pick before an order fires.
2. Fully automatic — order fires unattended in the existing `daily-run.yml` cron the moment the
   judge produces a pick, same as every other step in that pipeline today.

## Decision

Paper trading (option 1), fixed **$20 notional per pick** (option 1), fully automatic (option 2).

Paper trading because there's no reason to risk real money before the execution path has proven
itself — same logic that motivated the backtest harness for the research/judge path. Fixed $20
notional keeps sizing trivial to reason about and dodges the conviction-scaling design work
(mapping the judge's qualitative conviction to a quantitative size is a real research question,
not a default) until there's evidence the pipeline's picks are worth sizing up at all. Fully
automatic because paper trades have no real financial consequence, so there's no reason to require
a human in the loop yet — that changes when/if this goes live.

Alpaca's `notional` order parameter (fractional shares) is used instead of `qty`, so $20 buys a
fraction of a share regardless of the stock's price — no per-ticker share-count math needed.
Orders are market/day orders placed via `POST /v2/orders` against
`https://paper-api.alpaca.markets`, immediately after `recordPicks` in `src/index.ts`. Each
attempt (success or failure) is persisted to a new `trades` table via `src/db/tradeStore.ts`,
keyed to the pick it came from.

## Trade-off

This is a placeholder sizing rule, not a risk-management system — it doesn't scale with
conviction, account size, volatility, or existing exposure, and BACKLOG.md's "no position
sizing / risk management" item isn't actually closed, just given a deliberately dumb default good
enough to exercise the execution path. Going live with real money later needs that item revisited
for real, plus a funded/verified Alpaca account — this decision only covers paper trading.

The daily cron runs at ~11:00 UTC (pre-market, ~6-7am ET), so orders are typically queued
(`accepted`/`pending_new`) rather than filled at record time — `filled_avg_price`/`filled_qty`
land later when the market opens, and nothing currently reconciles the `trades` row after that.
Acceptable for now since paper fills have no real consequence to track precisely; worth fixing
before live trading matters.
