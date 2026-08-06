# 0014: Poll-and-alert reconciliation for pending Alpaca trades

## Context

`docs/decisions/0012-alpaca-paper-trading-execution.md` fires each day's paper order from the
pre-market cron (`daily-run.yml`, ~6-7am ET), so orders are recorded as `accepted`/`pending_new`,
not `filled` — the market hasn't opened yet. Nothing reconciled that row after the market actually
filled it, so a rejected/canceled/never-filled order would sit unresolved forever with no signal
that the "buy" never really happened.

## Options considered

**Cadence**
1. Ride the existing `update-price-series.yml` cron (already runs every 15 min during market
   hours, already has the same Alpaca credentials) and just check pending trades each time. No
   new workflow file, but a market day-order resolves (fills or doesn't) within roughly the first
   minute after the 9:30am ET open — checking again at 9:45, 10:00, 10:15 etc. finds nothing new.
   Cheap but not really *for* anything past the first check.
2. A single job, triggered once at market open, that polls Alpaca every 30s internally for up to
   30 min and exits as soon as everything resolves. Matches how the order actually behaves
   (resolves fast, or not at all) instead of a fixed external cadence.

**Alerting on an unresolved/failed order**
1. Exit non-zero on timeout and rely on GitHub Actions' default failure-email to the repo owner.
   Free, zero new integration.
2. Add a dedicated email service (e.g. Resend) for a formatted notification.
3. Add SMS (e.g. Twilio) for a text alert. Requires a paid account — flagged per the project's
   cost preference before ever pursuing.

## Decision

Option 2 for cadence: a new dedicated workflow (`reconcile-trades.yml`), single cron trigger at
13:30 UTC (~9:30am ET), running `pnpm reconcile-trades` (`src/execution/reconcileTrades.ts`). It
loads all non-terminal `trades` rows (`getPendingTrades`), polls Alpaca's `GET /v2/orders/{id}`
every 30s, and writes back `status`/`filled_qty`/`filled_avg_price` as each resolves
(`updateTradeStatus`). Terminal-status set (`TERMINAL_ORDER_STATUSES` in `tradeStore.ts`) treats
`filled` as success and `canceled`/`expired`/`rejected`/`stopped`/`suspended`/`calculated`/
`done_for_day` as resolved-but-failed (logged as a warning, not re-polled).

Option 1 for alerting: if anything is still unresolved after the 30-min budget, the script logs
which trade(s) and exits non-zero, so the GitHub Actions run shows as failed and GitHub's built-in
failure-email fires — no new service, no card, nothing to sign up for.

## Trade-off

Email-only means no SMS alert if the repo owner doesn't check email promptly; upgrading to a text
alert later needs a paid provider (Twilio or similar), deferred until email actually proves
insufficient. The 30-min budget is a guess at "clearly stuck" vs. "still working normally" — a day
order can't resolve past market close anyway (it expires), so 30 min was chosen as comfortably
longer than a normal fill takes, not because anything is known to break at exactly that mark.
