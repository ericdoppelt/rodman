# 0017 — Rank on the intraday drop, but tell the agent the whole day

## Context

`getLargestStockDips` ranks candidates by `(close - open) / open` — the move during the session.
The prompt then told the agent the stock "dropped X%" using that same number, as if it were the
day's decline.

For a stock whose drop began overnight, those are very different figures. BLLN on 2026-08-06:

| Window | Move |
|---|---|
| Prior close → open (overnight gap) | ~-30% |
| Open → close (intraday) | -12.85% |
| Prior close → close (day over day) | ~-39% |

The prompt said 12.85%. The bear agent researched the stock, found the real number, and wrote:
*"goes well beyond the modest 12.85% figure mentioned in the prompt — sources indicate the actual
decline was 38-39%."* It spent part of its reasoning correcting its own input, and the judge
received a brief arguing against a premise the pipeline had supplied.

## Options considered

1. **Rank on day-over-day instead.** Matches the conventional definition of "% change" and every
   quote service. But it changes the candidate universe: stocks that gap down hard and then trade
   flat would enter the screen.
2. **Keep intraday ranking, keep the prompt as-is.** No work. Leaves the agent contradicting its
   own prompt on any gap-driven drop, which is most earnings reactions — exactly the situations
   this strategy is hunting.
3. **Keep intraday ranking, give the agent all three numbers.** Ranking behavior is unchanged, so
   the existing forward-test record stays comparable; only the prompt gets more accurate.

## Decision

Option 3.

Ranking stays on the intraday move because the strategy's thesis is *panic*, not repricing. A stock
that gaps -30% on earnings and then holds is a market that has absorbed news and moved on; one that
gaps -30% and then bleeds another -13% while people watch it fall is a market still deciding. Only
the second is an overreaction anyone can trade against, and only the intraday window measures it.

The prompt now states the day-over-day move first (the real answer to "how far did it fall"), then
decomposes it into the overnight gap and the intraday slide, then says plainly which part the screen
selected on and why. `splitDayMove` in `schemas.ts` derives the gap and day-over-day figures from a
new `StockChange.previousClose`.

`previousClose` comes from one extra grouped-daily Polygon call per run, for the previous *trading*
day — the calendar moved to `src/marketCalendar.ts` so production and the backtest skip the same
closed days. If that call fails the run continues with a prompt that states only the intraday move
and says the prior close was unavailable: the gap is context, not something ranking depends on, so
losing it should degrade an analysis rather than fail a run.

## Trade-off

The screen still cannot see a stock that gapped down hard and then traded sideways, however large
the total move. That is deliberate under the thesis above, but it is a real blind spot and the
thesis is not yet validated by anything — the forward test has six scored picks. If the strategy
turns out to have an edge, this is a good candidate for the first A/B: same pipeline, day-over-day
ranking, compared on forward returns.

Cost is one Polygon call per run (~12s under the free tier's rate limit) and roughly 80 extra tokens
per bull/bear prompt.
