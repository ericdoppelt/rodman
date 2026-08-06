# 0014: Trade reconciliation cadence, and an external pinger for GitHub's unreliable scheduler

## Context

`docs/decisions/0012-alpaca-paper-trading-execution.md` fires each day's paper order from the
pre-market cron (`daily-run.yml`, ~6-7am ET), so orders are recorded as `accepted`/`pending_new`,
not `filled` — the market hasn't opened yet. Nothing reconciled that row after the market actually
filled it, so a rejected/canceled/never-filled order would sit unresolved forever with no signal
that the "buy" never really happened.

The first version of this decision (single dedicated cron, triggered once at market open, polling
internally for 30 min) turned out to rest on a bad assumption: that GitHub's `schedule` trigger
reliably fires when configured. It doesn't. GitHub's own docs: "The `schedule` event can be
delayed during periods of high loads of GitHub Actions workflow runs... If the load is sufficiently
high enough, some queued jobs may be dropped" — not delayed-then-run, dropped. Observed directly in
this repo: `update-price-series.yml`'s 15-min cron was actually landing every 1.5-2 hours. A
single once-a-day reconciliation trigger getting dropped means silent zero-reconciliation and
zero-alert that day — the exact failure mode this decision exists to prevent.

## Options considered

**Reconciliation cadence/architecture**
1. (Original decision, superseded) A dedicated `reconcile-trades.yml`, single cron trigger at
   market open, internal 30s-interval poll loop for up to 30 min. Matches how a day-order actually
   resolves (fast, or not at all), but is a single point of failure against GitHub's own
   scheduler dropping that one trigger.
2. Fold reconciliation into the existing `update-price-series.yml` cron as a second step (same
   job, same credentials already present). A dropped firing just gets caught by the next one,
   since the underlying cron already runs every 15 min. Requires reconcileTrades.ts to become a
   single stateless pass per invocation instead of an internal poll loop, since 15-min-cadence
   invocations shouldn't each also run their own 30-min internal loop (that would overlap
   invocations). "Stuck" is judged by wall-clock time since today's market open, not
   time-since-process-started, so it stays correct across many short invocations.

**Making the underlying cadence itself reliable**
1. Avoid round-number minute offsets (GitHub explicitly documents round times, especially the top
   of the hour, as the most congested). Free, but doesn't fix the root cause, just reduces how
   often it bites — and not worth the trade-off if the native trigger is being demoted to a bonus
   fallback anyway rather than depended on (decided against; see Decision).
2. External free cron service (e.g. cron-job.org, no card) calling this workflow's
   `workflow_dispatch` REST endpoint every 15 min, instead of relying on GitHub's native
   `schedule` trigger at all. GitHub's own scheduler becomes a bonus fallback rather than the
   primary mechanism. Trade-off: a new external dependency, and a GitHub PAT (scoped to just this
   repo, Actions-write-only) has to live on that third party's infrastructure instead of GitHub's
   secret store — a real new trust boundary, not free of downside.
3. Self-hosted always-on machine with real OS `cron`, bypassing GitHub Actions' scheduler
   entirely. Most reliable, but trades a serverless, self-managed CI job for an actual server the
   project now has to keep running and patched — disproportionate for ~30 calls/day.
4. Cloud schedulers (AWS EventBridge, GCP Cloud Scheduler) — SLA-backed and reliable, but almost
   certainly require a card on file, so flagged per the project's cost-preference rule rather than
   pursued directly.

## Decision

Cadence: option 2 — reconciliation is a second step in `update-price-series.yml`, not its own
workflow. `reconcileTrades.ts` does one pass per invocation: load non-terminal `trades` rows
(`getPendingTrades`), check each via Alpaca's `GET /v2/orders/{id}` once, write back
`status`/`filled_qty`/`filled_avg_price` for anything resolved (`updateTradeStatus`). Anything
still unresolved is only flagged as "stuck" (non-zero exit, so GitHub's default failure-email
fires) once wall-clock time is more than 30 min past today's 9:30am ET market open — computed
fresh each invocation, not tracked across a poll loop. Terminal-status set
(`TERMINAL_ORDER_STATUSES` in `tradeStore.ts`) treats `filled` as success and
`canceled`/`expired`/`rejected`/`stopped`/`suspended`/`calculated`/`done_for_day` as
resolved-but-failed.

Underlying reliability: option 2 only (external pinger) — option 1 (offsetting cron minutes) was
considered not worth it, since the native trigger is being treated as a bonus fallback rather than
the real mechanism once the external pinger exists; `update-price-series.yml` keeps its cron on
plain round numbers (`0,15,30,45`) for readability. The cron-job.org pinger is a manual setup step
outside this repo (needs a GitHub PAT and a third-party account, both requiring the repo owner's
own credentials) and is tracked separately rather than assumed complete just because this doc
mentions it — check BACKLOG.md for current status before assuming the 15-min cadence is actually
reliable yet.

Alerting stays as originally decided: GitHub's default failure-email (free, zero new service) over
SMS (would need a paid provider like Twilio).

## Trade-off

The external pinger, once set up, hands a real credential (a GitHub PAT, even if minimally scoped)
to a third-party service outside GitHub's own secret storage — a new trust boundary accepted in
exchange for actually getting the 15-min cadence this project wants, since GitHub's native
scheduler alone cannot guarantee it. Email-only alerting still means no SMS if the repo owner
doesn't check email promptly; deferred until that actually proves insufficient. The 30-min grace
period is a guess at "clearly stuck" vs. "still working normally," not a value anything is known to
break at exactly.
