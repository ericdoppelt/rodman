# 0009: Store `entry_price` on `picks` instead of deriving it from the hourly series

## Context

The web UI's "Picked · $X" marker and % return were computed client-side by scanning
`pick_price_series` for the last hourly bar whose UTC calendar date matched the pick's
`run_date`, then reading that bar's close (`trend.ts`'s `findEntryIndex`/`computePickReturn`).
This broke visibly for FIRY on 2026-07-28: the pipeline's hourly series includes extended-hours
bars, one of which fell late enough (near midnight UTC) to be picked as the "entry" bar while
displaying, via lightweight-charts' local-timezone axis labels, under July 29 — one day off from
the section header (which just prints `run_date` directly) and $0.56 off the real price ($9.28
shown vs. $9.84 actual close).

## Options considered

1. **Keep deriving it from the series, fix the timezone mismatch.** Make the date-matching and
   the chart's axis formatting agree on one timezone. Fixes the *display* bug but the entry price
   is still whatever hourly bar happens to match — a proxy for the real analysis input, not the
   real input itself.
2. **Store the price the pipeline actually reasoned about, at pick time.** `fetchTopDips.ts`
   already fetches each candidate's dip-day close before the judge ever sees it
   (`StockChange.close`). Persist that value directly on `picks.entry_price` when the pick is
   recorded, and have the UI read it instead of re-deriving anything.

## Decision

Went with option 2. `picks.entry_price` (nullable numeric) is now populated in `recordPicks`
(`src/db/runStore.ts`) from the same `StockChange.close` the judge's prompt was built from
(`src/index.ts`). The web UI (`PickChart.tsx`, `metrics.ts`) uses `pick.entry_price` directly for
the label and % return; the hourly series is now only used to draw the line and to position the
"Picked" marker visually (`findEntryIndex`), not to source the price. Also fixed
`dateStringOf` in `trend.ts` to truncate in local time (matching lightweight-charts' default axis
labels) instead of UTC, so the marker's visual position agrees with the header date.

The two existing picks predating this column (FIRY, MIR) were backfilled via
`scripts/backfillEntryPrices.ts`, which fetches each pick's `run_date` daily close from Polygon
— the best available reconstruction of "the price the pipeline would have recorded," since the
original per-candidate `StockChange` data wasn't persisted anywhere queryable.

## Trade-off

`entry_price` is a fact fixed at pick time — it doesn't reflect slippage, execution price, or
after-hours moves before a human could actually act on the recommendation. That's intentional:
it's meant to represent "the price the analysis was based on," not "the price you could have
traded at." The `pick_price_series` chart still shows real intraday movement around that point,
so the two aren't in conflict, but it's worth remembering `entry_price` is closer to "as-analyzed"
than "as-executed."
