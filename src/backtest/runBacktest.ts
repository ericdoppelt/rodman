import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from '../fetchTopDips.js';
import { pickStock } from '../judgeResearch.js';
import { pickStocksEliminatingLosers } from './eliminationJudge.js';
import { getTotalCost } from '../usageTracker.js';
import { researchStockChangesBacktest } from './backtestStockAgents.js';
import { getForwardReturns, type ForwardReturn } from './forwardReturn.js';
import { staticMarketCapLookup } from './staticMarketCap.js';
import { getHistoricalMarketNews } from './fetchHistoricalMarketNews.js';
import { getHistoricalNews } from './fetchHistoricalNews.js';
import { buildMarketContext } from './marketContext.js';
import { logBacktestRun } from './logBacktestRun.js';
import { readDailyCache, writeDailyCache, hasCompleteForwardReturns } from './dailyCache.js';
import { readScoredDay, writeScoredDay } from './scoringCache.js';
import type { NewsItem, StockChange } from '../schemas.js';
import { MODEL as PROD_BULL_BEAR_MODEL } from '../stockAgents.js';
import { MODEL as PROD_JUDGE_MODEL } from '../judgeResearch.js';
import {
  DIPS_PER_DAY,
  MARKET_NEWS_LIMIT,
  MIN_DOLLAR_VOLUME,
  MIN_MARKET_CAP,
  HORIZONS,
  PRIMARY_HORIZON,
  END_DATE_BUFFER_DAYS,
  LOOKBACK_WINDOW_DAYS,
} from './backtestConfig.js';

dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Overrides so the harness can be iterated on cheaply without touching the production model
// constants (stockAgents.ts / judgeResearch.ts) that src/index.ts's daily cron uses. Unset in
// production's env, so main's real runs are unaffected. BULL_BEAR_MODEL is optional — production's
// is already cheap Haiku, so leaving it unset (i.e. matching production) is fine for a run you
// intend to trust. See BACKLOG.md.
const BULL_BEAR_MODEL = process.env.BACKTEST_BULL_BEAR_MODEL || PROD_BULL_BEAR_MODEL;
// No fallback here, unlike BULL_BEAR_MODEL above: PROD_JUDGE_MODEL is claude-opus-5, which is
// both expensive to run at backtest volume and has real memorized knowledge of 2025 stock
// outcomes that contaminates backtest validity (see BACKLOG.md). A silent default to Opus here
// previously caused runs to use it without anyone intending that. Require an explicit choice —
// BACKTEST_JUDGE_MODEL=claude-sonnet-5 for cheap iteration, or =claude-opus-5 for a deliberate
// fidelity-matched run — every time, instead of defaulting to Opus when unset.
if (!process.env.BACKTEST_JUDGE_MODEL) {
  throw new Error(
    'BACKTEST_JUDGE_MODEL is not set. Set it explicitly (e.g. claude-sonnet-5 for cheap ' +
      'iteration, or claude-opus-5 for a deliberate fidelity-matched run) before running a backtest.'
  );
}
const JUDGE_MODEL = process.env.BACKTEST_JUDGE_MODEL;
// 'single' replays production's judge as-is (at most MAX_PICKS=1/day). 'eliminate' swaps in the
// backtest-only judge (eliminationJudge.ts) that defaults to buying every candidate and only
// excludes one for a genuine fundamental flaw — a different hypothesis (screening out duds vs.
// picking a single winner), and a different n (up to DIPS_PER_DAY picks/day instead of 0-1).
// Production always runs 'single' — this never touches judgeResearch.ts/schemas.ts.
const STRATEGY: 'single' | 'eliminate' = process.env.BACKTEST_STRATEGY === 'eliminate' ? 'eliminate' : 'single';
// Scoped to the model pair AND strategy so switching either starts a fresh progress directory
// instead of resuming with picks scored under a different config — see scoringCache.ts.
const RUN_KEY = `${BULL_BEAR_MODEL}__${JUDGE_MODEL}__${STRATEGY}`;

// How many past days (that actually had a qualifying dip) to test. Lowered from 100 to keep
// smaller/cheaper runs the default — override with more days once a strategy looks promising.
const TEST_TRADING_DAYS = 25;
// Safety cap on sampling attempts in case too few days in the window have qualifying dips.
const MAX_SAMPLE_ATTEMPTS = 300;
// Fixed seed so the sampled dates (and thus the result) are reproducible across runs.
const RANDOM_SEED = 42;
// How many days' worth of Claude research run concurrently. Each day fires up to
// DIPS_PER_DAY*2 bull/bear calls at once (already concurrent within one day, see
// backtestStockAgents.ts) plus one judge call, so this multiplies out fast — e.g. 4 days at
// DIPS_PER_DAY=4 is up to 32 simultaneous bull/bear calls. There's no way to read your actual
// Anthropic rate-limit tier from the API, so this defaults conservatively; the SDK's own default
// retry-with-backoff (client.messages.create's built-in maxRetries) absorbs occasional 429s from
// bursty overlap, but a sustained overshoot will still slow things down via retries rather than
// speed them up. Raise via BACKTEST_CONCURRENCY once you know your tier's real headroom.
const CONCURRENCY = Number(process.env.BACKTEST_CONCURRENCY) || 4;

// Deterministic PRNG (mulberry32) — Math.random() isn't seedable, and reproducible sampling
// means the exact test dates (and result) can be reported and re-verified, not just asserted.
function _createRandom(seed: number): () => number {
  let state = seed;
  return function random(): number {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// This is a judge-calibration backtest, not a full-pipeline validation: bull/bear research
// here is built on Polygon news snippets (point-in-time-safe), not the live `web_search` that
// production actually uses, so results say whether the judge's conviction logic tracks
// outcomes given *some* reasonable evidence — not whether the deployed pipeline beats a
// baseline. Market context (see marketContext.ts) is similarly built from retrieved
// index/sector data and headlines rather than an AI-written summary, for the same
// point-in-time-safety reason — see docs/decisions/0004-point-in-time-market-context-for-backtest.md.
// See BACKLOG.md.

interface DayResult {
  date: string;
  candidates: { ticker: string; returns: Map<number, number> }[];
  pickTickers: string[];
}

// Raw inputs for one test date, gathered during the (still-sequential, Polygon-rate-limited on a
// cache miss) sampling phase, deferred here so the Claude research/judge work below can run
// several dates at once instead of one at a time.
interface DayContext {
  testDate: Date;
  dateKey: string;
  dips: StockChange[];
  marketContextPromise: Promise<string>;
  newsLookup: (ticker: string, date: Date) => Promise<NewsItem[]>;
  finalizeCache: (() => void) | undefined;
  forwardReturnsPromise: Promise<(Map<number, ForwardReturn> | undefined)[]>;
}

// Builds a day's full result (candidates + their returns at every currently-configured horizon)
// purely from dailyCache — no Claude involved. This is what lets adding a horizon later be free:
// the judge's pick (persisted in scoringCache, keyed only by date) is combined with whatever
// forward-return data dailyCache has *right now*, so re-running aggregation after a
// warmCache.ts backfill picks up the new horizon automatically, for every date ever scored.
function _computeDayResult(dateKey: string, pickTickers: string[]): DayResult {
  const cached = readDailyCache(dateKey);
  if (!cached) throw new Error(`No dailyCache entry for ${dateKey} — a scored day should always have one`);
  const candidates: DayResult['candidates'] = cached.dips.map(dip => {
    const perTicker = cached.forwardReturns?.[dip.ticker];
    const returns = new Map<number, number>();
    for (const horizon of HORIZONS) {
      const fr = perTicker?.[horizon];
      if (fr) returns.set(horizon, fr.pctReturn);
    }
    return { ticker: dip.ticker, returns };
  });
  return { date: dateKey, candidates, pickTickers };
}

// Runs `worker` over `items` with at most `concurrency` in flight at once — a plain worker-pool
// (no library) since the only real requirement is a hard cap, not scheduling fairness.
async function _runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    for (let i = nextIndex++; i < items.length; i = nextIndex++) {
      results[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set');

  console.log(`Models: bull/bear=${BULL_BEAR_MODEL}${BULL_BEAR_MODEL !== PROD_BULL_BEAR_MODEL ? ' (override, not production)' : ''}, judge=${JUDGE_MODEL}${JUDGE_MODEL !== PROD_JUDGE_MODEL ? ' (override, not production)' : ''}`);
  console.log(`Strategy: ${STRATEGY}${STRATEGY === 'eliminate' ? ' (keep-all-unless-flawed, backtest-only — not production behavior)' : ''}`);

  const random = _createRandom(RANDOM_SEED);

  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - LOOKBACK_WINDOW_DAYS);
  const latestDate = new Date();
  latestDate.setDate(latestDate.getDate() - END_DATE_BUFFER_DAYS);
  const rangeMs = latestDate.getTime() - earliestDate.getTime();

  // --- Phase 1: sample dates and gather raw inputs (sequential — a cache miss here is bound by
  // Polygon's rate limit regardless of what we do downstream; see warmCache.ts to avoid misses). ---
  const dayContexts: DayContext[] = [];
  // Days already scored (by RUN_KEY) on a prior, interrupted run — the pick is loaded straight
  // from disk (no Claude spend); returns get computed fresh from dailyCache at aggregation time
  // below, via _computeDayResult, so these stay valid even if HORIZONS has changed since. See
  // scoringCache.ts.
  const resumedPicks: { dateKey: string; pickTickers: string[] }[] = [];
  const triedDates = new Set<string>();
  let sampleAttempts = 0;
  while (resumedPicks.length + dayContexts.length < TEST_TRADING_DAYS && sampleAttempts < MAX_SAMPLE_ATTEMPTS) {
    sampleAttempts++;
    const testDate = new Date(earliestDate.getTime() + Math.floor(random() * rangeMs));
    testDate.setHours(0, 0, 0, 0);
    const dateKey = testDate.toISOString().slice(0, 10);
    if (triedDates.has(dateKey)) continue; // already sampled this exact date — draw again
    triedDates.add(dateKey);

    const scored = readScoredDay(RUN_KEY, dateKey);
    if (scored) {
      console.log(`--- ${dateKey} (sample ${sampleAttempts}) --- already scored, resuming from disk`);
      resumedPicks.push({ dateKey, pickTickers: scored.picks.map(p => p.ticker) });
      continue;
    }

    console.log(`--- ${dateKey} (sample ${sampleAttempts}) ---`);

    // Raw, model-independent inputs (candidates, index/sector data, news) are cached per date
    // after the first fetch — see dailyCache.ts. A cache hit skips Polygon/Tavily entirely, so
    // re-running the backtest against a different bull/bear or judge model only re-pays Claude
    // token cost, not another full data-gathering pass.
    const cached = readDailyCache(dateKey);

    let dips: StockChange[];
    let marketContextPromise: Promise<string>;
    let newsLookup: (ticker: string, date: Date) => Promise<NewsItem[]>;
    let finalizeCache: (() => void) | undefined;
    // Forward returns are historical price data — fixed once the date has passed — so a cache hit
    // (including one written by warmCache.ts) skips Polygon for them entirely, same as dips/news.
    let forwardReturnsPromise: Promise<(Map<number, ForwardReturn> | undefined)[]>;

    if (cached && hasCompleteForwardReturns(cached, HORIZONS)) {
      dips = cached.dips;
      marketContextPromise = Promise.resolve(buildMarketContext(testDate, cached.allResults, cached.marketNews));
      newsLookup = async ticker => cached.perTickerNews[ticker] ?? [];
      forwardReturnsPromise = Promise.resolve(dips.map(dip => {
        const perTicker = cached.forwardReturns![dip.ticker];
        return perTicker ? new Map(Object.entries(perTicker).map(([h, fr]) => [Number(h), fr])) : undefined;
      }));
    } else if (cached) {
      // Dips/news are still valid (model-independent), but a horizon was added to HORIZONS since
      // this date was cached, so forward returns are incomplete — refetch just those and persist
      // the backfill so future runs don't repeat this fetch. See dailyCache.ts.
      dips = cached.dips;
      marketContextPromise = Promise.resolve(buildMarketContext(testDate, cached.allResults, cached.marketNews));
      newsLookup = async ticker => cached.perTickerNews[ticker] ?? [];

      const forwardReturnsForCache: Record<string, Record<number, ForwardReturn>> = {};
      forwardReturnsPromise = Promise.all(dips.map(async dip => {
        const forward = await getForwardReturns(dip.ticker, testDate, HORIZONS);
        if (forward) forwardReturnsForCache[dip.ticker] = Object.fromEntries(forward);
        return forward;
      }));

      finalizeCache = () => {
        writeDailyCache(dateKey, { ...cached, forwardReturns: forwardReturnsForCache });
      };
    } else {
      const fetched = await getLargestStockDips(testDate, DIPS_PER_DAY, MIN_DOLLAR_VOLUME, MIN_MARKET_CAP, staticMarketCapLookup);
      dips = fetched.qualifying;
      if (dips.length === 0) {
        console.log('No qualifying dips (weekend/holiday/no data) — skipping.');
        continue;
      }

      // Fire every network call for this day up front — market news, forward returns, and (inside
      // researchStockChangesBacktest) each candidate's point-in-time news — so they overlap with
      // the Claude research calls instead of adding on top of them serially.
      let marketNewsForCache: NewsItem[] = [];
      marketContextPromise = getHistoricalMarketNews(testDate, MARKET_NEWS_LIMIT)
        .then(news => {
          marketNewsForCache = news;
          return buildMarketContext(testDate, fetched.allResults, news);
        });

      const perTickerNewsForCache: Record<string, NewsItem[]> = {};
      newsLookup = async (ticker, date) => {
        const news = await getHistoricalNews(ticker, date);
        perTickerNewsForCache[ticker] = news;
        return news;
      };

      const forwardReturnsForCache: Record<string, Record<number, ForwardReturn>> = {};
      forwardReturnsPromise = Promise.all(dips.map(async dip => {
        const forward = await getForwardReturns(dip.ticker, testDate, HORIZONS);
        if (forward) forwardReturnsForCache[dip.ticker] = Object.fromEntries(forward);
        return forward;
      }));

      finalizeCache = () => {
        writeDailyCache(dateKey, {
          dips,
          allResults: fetched.allResults,
          marketNews: marketNewsForCache,
          perTickerNews: perTickerNewsForCache,
          forwardReturns: forwardReturnsForCache,
        });
      };
    }

    if (dips.length === 0) {
      console.log('No qualifying dips (cached) — skipping.');
      continue;
    }

    dayContexts.push({ testDate, dateKey, dips, marketContextPromise, newsLookup, finalizeCache, forwardReturnsPromise });
  }

  // --- Phase 2: research + judge each sampled date, up to CONCURRENCY at once. Independent of
  // Phase 1 now that raw inputs are already resolved/in flight, so this is the part that actually
  // benefits from parallelizing — see BACKTEST_CONCURRENCY above. ---
  console.log(`\nScoring ${dayContexts.length} day(s), up to ${CONCURRENCY} concurrently...`);
  const freshPicks = await _runWithConcurrency(dayContexts, CONCURRENCY, async ctx => {
    const { testDate, dateKey, dips, marketContextPromise, newsLookup, finalizeCache, forwardReturnsPromise } = ctx;

    // Caught per-day (rather than letting one flaky call kill the whole Promise.all) so a network
    // blip only costs this one day's Claude spend, not every day already scored in this run — the
    // failed date just isn't written to scoringCache, so it's retried on the next `pnpm backtest`.
    try {
      const research = await researchStockChangesBacktest(client, dips, marketContextPromise, testDate, newsLookup, BULL_BEAR_MODEL);
      const picks = STRATEGY === 'eliminate'
        ? await pickStocksEliminatingLosers(client, research, testDate, JUDGE_MODEL)
        : await pickStock(client, research, testDate, undefined, JUDGE_MODEL);
      if (finalizeCache) {
        await Promise.all([marketContextPromise, forwardReturnsPromise]); // ensure cache-fill side effects have populated before writing
        finalizeCache();
      }
      const pickTickers = picks.map(p => p.ticker);

      // Just for immediate visibility while the run is in progress — the persisted/aggregated
      // numbers always come from _computeDayResult reading dailyCache fresh, not from this.
      const forwardReturnsList = await forwardReturnsPromise;
      dips.forEach((dip, i) => {
        const forward = forwardReturnsList[i];
        const summary = HORIZONS.map(h => `${h}d: ${forward?.get(h) ? forward.get(h)!.pctReturn.toFixed(2) + '%' : 'unavailable'}`).join(', ');
        console.log(`[${dateKey}] ${dip.ticker}: dropped ${dip.percentageChange.toFixed(2)}%, forward returns — ${summary}`);
      });

      if (pickTickers.length > 0) {
        const verb = STRATEGY === 'eliminate' ? 'KEEP' : 'PICK';
        for (const p of picks) console.log(`[${dateKey}] JUDGE ${verb}: ${p.ticker} — ${p.reasoning}`);
        if (STRATEGY === 'eliminate') {
          const excluded = dips.map(d => d.ticker).filter(t => !pickTickers.includes(t));
          if (excluded.length > 0) console.log(`[${dateKey}] JUDGE EXCLUDE: ${excluded.join(', ')}`);
        }
      } else {
        console.log(`[${dateKey}] JUDGE PICK: none (no stock met the conviction bar)`);
      }

      writeScoredDay(RUN_KEY, dateKey, { picks: picks.map(p => ({ ticker: p.ticker, reasoning: p.reasoning })) });
      return { dateKey, pickTickers };
    } catch (err) {
      console.error(`[${dateKey}] Failed to score, skipping — will retry on next run: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  });

  // --- Aggregate (resumed picks loaded from disk + freshly-scored picks from this run), building
  // each day's full result from dailyCache fresh so it reflects the current HORIZONS regardless
  // of what was configured when the pick was originally made. ---
  const allPicks = [...resumedPicks, ...freshPicks.filter((p): p is { dateKey: string; pickTickers: string[] } => p !== undefined)];
  const results = allPicks.map(p => _computeDayResult(p.dateKey, p.pickTickers));
  const daysWithPick = results.filter(r => r.pickTickers.length > 0).length;
  const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
  const winRate = (nums: number[]) => nums.length > 0 ? nums.filter(n => n > 0).length / nums.length : undefined;

  console.log('\n=== Backtest Summary (judge-calibration only — see caveat above) ===');
  console.log(`Days tested: ${results.length} (of ${sampleAttempts} random dates sampled from the past ${LOOKBACK_WINDOW_DAYS} days)`);
  console.log(`Days with a pick: ${daysWithPick} / ${results.length}`);

  const perHorizon = HORIZONS.map(horizon => {
    const allCandidateReturns = results.flatMap(r => r.candidates.map(c => c.returns.get(horizon))).filter((r): r is number => r !== undefined);
    const pickReturns = results
      .flatMap(r => r.pickTickers.map(t => r.candidates.find(c => c.ticker === t)?.returns.get(horizon)))
      .filter((r): r is number => r !== undefined);

    const label = horizon === PRIMARY_HORIZON ? `${horizon}-day (primary)` : `${horizon}-day`;
    console.log(`\n[${label}]`);
    console.log(`  Baseline (every qualifying dip) avg return: ${avg(allCandidateReturns)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(allCandidateReturns) ?? 0) * 100).toFixed(0)}%, n=${allCandidateReturns.length})`);
    console.log(`  Judge picks avg return: ${avg(pickReturns)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(pickReturns) ?? 0) * 100).toFixed(0)}%, n=${pickReturns.length})`);

    return {
      horizon,
      baselineAvgReturn: avg(allCandidateReturns),
      baselineWinRate: winRate(allCandidateReturns),
      baselineN: allCandidateReturns.length,
      pickAvgReturn: avg(pickReturns),
      pickWinRate: winRate(pickReturns),
      pickN: pickReturns.length,
    };
  });

  const totalClaudeApiCostUsd = getTotalCost();
  console.log(`\nTotal Claude API cost: $${totalClaudeApiCostUsd.toFixed(4)}`);

  logBacktestRun(
    {
      testTradingDaysTarget: TEST_TRADING_DAYS,
      dipsPerDay: DIPS_PER_DAY,
      minDollarVolume: MIN_DOLLAR_VOLUME,
      minMarketCap: MIN_MARKET_CAP,
      horizons: HORIZONS,
      primaryHorizon: PRIMARY_HORIZON,
      lookbackWindowDays: LOOKBACK_WINDOW_DAYS,
      maxSampleAttempts: MAX_SAMPLE_ATTEMPTS,
      randomSeed: RANDOM_SEED,
      marketNewsLimit: MARKET_NEWS_LIMIT,
      bullBearModel: BULL_BEAR_MODEL,
      judgeModel: JUDGE_MODEL,
      strategy: STRATEGY,
    },
    {
      daysTested: results.length,
      sampleAttemptsUsed: sampleAttempts,
      daysWithPick,
      perHorizon,
      totalClaudeApiCostUsd,
    },
  );
}

main().catch(console.error);
