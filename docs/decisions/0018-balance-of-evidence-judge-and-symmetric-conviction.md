# 0018 — Judge on the balance of evidence, and grade both agents on one scale

## Context

Six of the seven sessions to 2026-08-17 declined to pick. The pipeline was healthy throughout:
every run completed all 21 calls, prompt hashes in `llm_calls` confirm the bull and bear system
prompts had not changed since 2026-07-28, and each decline came back with a specific, reasoned
`noPickReason`. Nothing was broken. The bar was simply not being cleared.

Two facts explain why. First, the conviction labels the judge reads were never on the same scale:

| | strong | moderate | weak |
|---|---|---|---|
| bull (153 calls) | **1** | 119 | 33 |
| bear (152 calls) | **107** | 40 | 5 |

`BULL_SYSTEM_PROMPT` graded the conviction field — *use "weak" if evidence is thin or mixed,
"moderate" if reasonable but not compelling, "strong" only if evidence clearly supports a buying
opportunity* — and `BEAR_SYSTEM_PROMPT` carried the bare sentence with no rubric. Same model, same
task, one side told to be strict. The bull said "strong" 0.7% of the time; the bear, 70%.

Second, `JUDGE_SYSTEM_PROMPT`'s first rule was *"Only include a stock if you have STRONG conviction
it is a buying opportunity"* — a level of certainty the bull agent had been instructed out of
expressing. The judge was asked to clear a bar its inputs could not reach.

The two compounded. It picked anyway for three weeks, while candidates were large-cap earnings
gap-downs (COHR, LITE, WOLF on 2026-08-10). Once Q2 season ended and the screen filled with
microcap distress (OTLK, NNNN, PICS, AMPG), the prose stopped overriding the labels and the pick
rate went to zero.

## Options considered

1. **Fix the rubric asymmetry only.** Honest bug fix, no change to the strategy's stated bar.
   But it cannot be measured without re-running research (~$0.90/day), and it leaves a judge still
   asking for a certainty level that rarely exists in a stock that just fell 15%.
2. **Reframe the judge as best-of-ten** — rank all candidates, take the top one unless it hits a
   hard disqualifier. Guarantees a near-daily pick. Rejected: it converts the strategy from
   "buy dislocations when you find one" to "buy something every day", and days like 2026-08-14
   (ten distressed microcaps) genuinely have no buy in them.
3. **Raise the screen floors** ($100M → $1B market cap, $10M → $50M dollar volume) so the judge
   sees real companies. Not chosen now; it addresses candidate quality rather than the bar, and
   is worth doing on its own merits later.
4. **Fix the rubric and lower the bar to the balance of evidence.** Chosen.

## Decision

Both. `BEAR_SYSTEM_PROMPT` gets the same rubric the bull has, mirrored for its claim. The judge's
first rule becomes *"Include a stock if the evidence, on balance, supports it being a buying
opportunity"*. The empty array survives, and is still described as preferred when evidence is weak
— declining stays possible, it just stops being the default.

Measured with `scripts/replayJudgePrompt.ts`, which replays each day's stored judge prompt verbatim
under both system prompts (24 calls, $2.83, no re-research, nothing written):

| arm | picked |
|---|---|
| old prompt | 4 / 12 |
| new prompt | 9 / 12 |

Fisher's exact two-sided p = 0.10 — the direction is clear, the sample is not conclusive.
2026-08-14 declined in all four draws under both prompts, which is the intended behavior on a slate
with nothing in it.

## Trade-off

More picks, lower average conviction behind each one, and a real chance the win rate falls: the
marginal pick this unlocks is by construction one the old prompt would have refused. The replay
measures only the judge change — the bear rubric alters the research text itself, which is frozen
in the stored prompts, so its effect is unmeasured and rides live.

One finding to keep in view: the old prompt picked 4/12 on replay while it declined 6/6 live on the
same inputs. Part of the drought was the draw, not the prompt. Judge decisions are noisier than a
single run suggests, and any future read on whether this helped needs more than a few sessions.
