import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from '../fetchTopDips.js';
import { pickStock } from '../judgeResearch.js';
import { getTotalCost } from '../usageTracker.js';
import { researchStockChangesBacktest } from './backtestStockAgents.js';
import { getForwardReturns, type ForwardReturn } from './forwardReturn.js';
import { staticMarketCapLookup } from './staticMarketCap.js';
import { getHistoricalMarketNews } from './fetchHistoricalMarketNews.js';
import { getHistoricalNews } from './fetchHistoricalNews.js';
import { buildMarketContext } from './marketContext.js';
import { logBacktestRun } from './logBacktestRun.js';
import { readDailyCache, writeDailyCache } from './dailyCache.js';
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

// Optional overrides so the harness can be iterated on cheaply without touching the production
// model constants (stockAgents.ts / judgeResearch.ts) that src/index.ts's daily cron uses.
// Unset in production's env, so main's real runs are unaffected — only set these locally when
// debugging the backtest itself. Every scored run you actually intend to trust should be run
// with these unset (i.e. production's real models), or the result doesn't validate what's
// deployed. See BACKLOG.md.
const BULL_BEAR_MODEL = process.env.BACKTEST_BULL_BEAR_MODEL || PROD_BULL_BEAR_MODEL;
const JUDGE_MODEL = process.env.BACKTEST_JUDGE_MODEL || PROD_JUDGE_MODEL;

// How many past days (that actually had a qualifying dip) to test.
const TEST_TRADING_DAYS = 30;
// Safety cap on sampling attempts in case too few days in the window have qualifying dips.
const MAX_SAMPLE_ATTEMPTS = 300;
// Fixed seed so the sampled dates (and thus the result) are reproducible across runs.
const RANDOM_SEED = 42;

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
  pickTicker: string | undefined;
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set');

  console.log(`Models: bull/bear=${BULL_BEAR_MODEL}${BULL_BEAR_MODEL !== PROD_BULL_BEAR_MODEL ? ' (override, not production)' : ''}, judge=${JUDGE_MODEL}${JUDGE_MODEL !== PROD_JUDGE_MODEL ? ' (override, not production)' : ''}`);

  const results: DayResult[] = [];
  const random = _createRandom(RANDOM_SEED);

  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - LOOKBACK_WINDOW_DAYS);
  const latestDate = new Date();
  latestDate.setDate(latestDate.getDate() - END_DATE_BUFFER_DAYS);
  const rangeMs = latestDate.getTime() - earliestDate.getTime();

  const triedDates = new Set<string>();
  let sampleAttempts = 0;
  while (results.length < TEST_TRADING_DAYS && sampleAttempts < MAX_SAMPLE_ATTEMPTS) {
    sampleAttempts++;
    const testDate = new Date(earliestDate.getTime() + Math.floor(random() * rangeMs));
    testDate.setHours(0, 0, 0, 0);
    const dateKey = testDate.toISOString().slice(0, 10);
    if (triedDates.has(dateKey)) continue; // already sampled this exact date — draw again
    triedDates.add(dateKey);

    console.log(`\n--- ${dateKey} (sample ${sampleAttempts}) ---`);

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

    if (cached) {
      dips = cached.dips;
      marketContextPromise = Promise.resolve(buildMarketContext(testDate, cached.allResults, cached.marketNews));
      newsLookup = async ticker => cached.perTickerNews[ticker] ?? [];
      forwardReturnsPromise = cached.forwardReturns
        ? Promise.resolve(dips.map(dip => {
            const perTicker = cached.forwardReturns![dip.ticker];
            return perTicker ? new Map(Object.entries(perTicker).map(([h, fr]) => [Number(h), fr])) : undefined;
          }))
        : Promise.all(dips.map(dip => getForwardReturns(dip.ticker, testDate, HORIZONS)));
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

    const research = await researchStockChangesBacktest(client, dips, marketContextPromise, testDate, newsLookup, BULL_BEAR_MODEL);
    const picks = await pickStock(client, research, testDate, undefined, JUDGE_MODEL);
    if (finalizeCache) {
      await Promise.all([marketContextPromise, forwardReturnsPromise]); // ensure cache-fill side effects have populated before writing
      finalizeCache();
    }
    const pickTicker = picks[0]?.ticker;

    const forwardReturnsList = await forwardReturnsPromise;
    const candidates: DayResult['candidates'] = dips.map((dip, i) => {
      const forward = forwardReturnsList[i];
      const returns = new Map<number, number>();
      for (const [horizon, fr] of forward ?? []) returns.set(horizon, fr.pctReturn);
      const summary = HORIZONS.map(h => `${h}d: ${returns.has(h) ? returns.get(h)!.toFixed(2) + '%' : 'unavailable'}`).join(', ');
      console.log(`  ${dip.ticker}: dropped ${dip.percentageChange.toFixed(2)}%, forward returns — ${summary}`);
      return { ticker: dip.ticker, returns };
    });

    console.log(pickTicker ? `  JUDGE PICK: ${pickTicker} — ${picks[0]?.reasoning}` : '  JUDGE PICK: none (no stock met the conviction bar)');

    results.push({ date: testDate.toISOString().slice(0, 10), candidates, pickTicker });
  }

  // --- Aggregate ---
  const daysWithPick = results.filter(r => r.pickTicker !== undefined).length;
  const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
  const winRate = (nums: number[]) => nums.length > 0 ? nums.filter(n => n > 0).length / nums.length : undefined;

  console.log('\n=== Backtest Summary (judge-calibration only — see caveat above) ===');
  console.log(`Days tested: ${results.length} (of ${sampleAttempts} random dates sampled from the past ${LOOKBACK_WINDOW_DAYS} days)`);
  console.log(`Days with a pick: ${daysWithPick} / ${results.length}`);

  const perHorizon = HORIZONS.map(horizon => {
    const allCandidateReturns = results.flatMap(r => r.candidates.map(c => c.returns.get(horizon))).filter((r): r is number => r !== undefined);
    const pickReturns = results
      .map(r => r.pickTicker ? r.candidates.find(c => c.ticker === r.pickTicker)?.returns.get(horizon) : undefined)
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
