# 0008: Sonnet judge for backtest runs, Opus judge in production

## Context

Production's judge (`judgeResearch.ts`) was upgraded to `claude-opus-5` for stronger final-pick
reasoning (commit `0192705`). Reusing that same shared `MODEL` constant for `pnpm backtest` means
a 30-day backtest pays Opus pricing on every judge call too — and since `runBacktest.ts` imports
`pickStock` directly to score "the real, unmodified judge" (see its top-of-file comment), there was
no way to control backtest cost without either editing the shared production constant (which
previously happened by accident — see BACKLOG history) or adding a way to diverge the two.

## Options considered

1. **No override — always match production.** Simplest, and the only way a backtest result
   directly validates what's deployed. Cost isn't actually prohibitive here (judge is a small
   fraction of call volume vs. bull/bear), but it's nonzero on every iteration of the harness
   itself, not just final scored runs.
2. **Env-var override (`BACKTEST_JUDGE_MODEL` / `BACKTEST_BULL_BEAR_MODEL`), unset by default.**
   Defaults to matching production; only diverges when explicitly set. Keeps `src/index.ts`'s
   production path untouched regardless of what's set locally for backtesting.
3. **Permanently run backtest judge on Sonnet, not Opus.** Cheaper on every run, including ones
   whose results you intend to treat as real signal — at the cost of never actually validating
   the deployed Opus judge's calibration, only Sonnet's.

## Decision

Built option 2 (`BACKTEST_JUDGE_MODEL`, `BACKTEST_BULL_BEAR_MODEL` in `runBacktest.ts`, logged
per-run in `data/backtest-run-log.jsonl` alongside a flag when they diverge from production), but
the current operating choice is option 3: `BACKTEST_JUDGE_MODEL=claude-sonnet-5` is the intended
default going forward, prioritizing cost control over exact fidelity to the deployed judge.

## Trade-off

Every backtest run under this default validates Sonnet's conviction-calibration logic, not
Opus's — the numbers say something about the judge's decision-making pattern in general, but not
specifically about the model actually picking stocks in production. If Opus and Sonnet reason
differently enough about conviction thresholds, a backtest result here could look good (or bad)
without that holding for the real deployed judge. Revisit by unsetting the override (or exporting
`BACKTEST_JUDGE_MODEL=claude-opus-5` for a specific run) when a trustworthy, fidelity-matched
result is actually needed — e.g. before making a real decision based on backtest output.
