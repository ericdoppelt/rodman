import { appendFileSync, statSync } from 'fs';
import { getGitSha } from '../gitSha.js';
import { BULL_SYSTEM_PROMPT, BEAR_SYSTEM_PROMPT, MODEL as PROD_BULL_BEAR_MODEL, MAX_TOKENS as RESEARCH_MAX_TOKENS } from '../stockAgents.js';
import { JUDGE_SYSTEM_PROMPT, MODEL as PROD_JUDGE_MODEL, MAX_TOKENS as JUDGE_MAX_TOKENS } from '../judgeResearch.js';
import { ELIMINATION_JUDGE_SYSTEM_PROMPT } from './eliminationJudge.js';
import { MAX_PICKS } from '../schemas.js';

// One JSON record per `pnpm backtest` run, appended (never overwritten) so results are
// comparable across runs over time — same idea as data/forward-test-log.jsonl for production
// runs. Lives in the gitignored data/ dir since it's a local run history, not checked-in config.
const LOG_PATH = new URL('../../data/backtest-run-log.jsonl', import.meta.url);
const MARKET_CAP_SNAPSHOT_PATH = new URL('../data/market-caps.csv', import.meta.url);

export interface BacktestHorizonResult {
  horizon: number;
  baselineAvgReturn: number | undefined;
  baselineWinRate: number | undefined;
  baselineN: number;
  pickAvgReturn: number | undefined;
  pickWinRate: number | undefined;
  pickN: number;
}

export interface BacktestRunParams {
  testTradingDaysTarget: number;
  dipsPerDay: number;
  minDollarVolume: number;
  minMarketCap: number;
  horizons: number[];
  primaryHorizon: number;
  lookbackWindowDays: number;
  maxSampleAttempts: number;
  randomSeed: number;
  marketNewsLimit: number;
  bullBearModel: string;
  judgeModel: string;
  // 'single' = production's judge (at most MAX_PICKS=1 pick/day). 'eliminate' = the backtest-only
  // alternate that defaults to keeping every candidate, excluding only a fundamentally flawed one
  // — see eliminationJudge.ts. Never affects production, which always runs 'single'.
  strategy: 'single' | 'eliminate';
}

export interface BacktestRunResult {
  daysTested: number;
  sampleAttemptsUsed: number;
  daysWithPick: number;
  perHorizon: BacktestHorizonResult[];
  totalClaudeApiCostUsd: number;
}

// Known approximations baked into every run, independent of the specific parameters above —
// recorded so results can't be read as more rigorous than they are. See BACKLOG.md and
// docs/decisions/0003 and 0004 for the reasoning behind each.
const LIMITATIONS = [
  'Bull/bear research uses Tavily search results (end_date-filtered), not the live web_search production uses — narrower index than a real web search, so this validates the judge\'s conviction-calibration logic only, not the deployed pipeline.',
  'Market-cap filter uses a static snapshot (see marketCapSnapshotVintage below), not a live per-ticker lookup — a speed/reproducibility trade specific to the backtest.',
  'Market context is built from retrieved index/sector price data and real headlines with no AI summarization step, to avoid the model leaning on memorized knowledge of well-covered macro events instead of the retrieved evidence.',
  'The underlying model may already know how a historical test date actually played out from its own pretraining, independent of the point-in-time evidence fed to it — a risk inherent to LLM-based backtesting that published_utc.lte filtering does not eliminate.',
];

function _marketCapSnapshotVintage(): string | undefined {
  try {
    return statSync(MARKET_CAP_SNAPSHOT_PATH).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** Appends one record capturing this run's full parameters, prompts, limitations, and results. */
export function logBacktestRun(params: BacktestRunParams, result: BacktestRunResult): void {
  const limitations = [...LIMITATIONS];
  if (params.bullBearModel !== PROD_BULL_BEAR_MODEL || params.judgeModel !== PROD_JUDGE_MODEL) {
    limitations.push(
      `Model override in effect (BACKTEST_BULL_BEAR_MODEL/BACKTEST_JUDGE_MODEL) — this run used bull/bear=${params.bullBearModel}, judge=${params.judgeModel}, ` +
      `vs. production's bull/bear=${PROD_BULL_BEAR_MODEL}, judge=${PROD_JUDGE_MODEL}. Results are only a harness sanity-check, not a validation of production's actual models.`,
    );
  }

  const record = {
    timestamp: new Date().toISOString(),
    gitSha: getGitSha(),
    parameters: {
      ...params,
      maxPicksPerDay: params.strategy === 'eliminate' ? params.dipsPerDay : MAX_PICKS,
      marketCapSnapshotVintage: _marketCapSnapshotVintage(),
      bullBear: {
        model: params.bullBearModel,
        maxTokens: RESEARCH_MAX_TOKENS,
        bullSystemPrompt: BULL_SYSTEM_PROMPT,
        bearSystemPrompt: BEAR_SYSTEM_PROMPT,
      },
      judge: {
        model: params.judgeModel,
        maxTokens: JUDGE_MAX_TOKENS,
        systemPrompt: params.strategy === 'eliminate' ? ELIMINATION_JUDGE_SYSTEM_PROMPT : JUDGE_SYSTEM_PROMPT,
      },
    },
    limitations,
    result,
  };
  appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
}
