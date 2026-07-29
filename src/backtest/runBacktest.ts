import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from '../fetchTopDips.js';
import { pickStock } from '../judgeResearch.js';
import { getTotalCost } from '../usageTracker.js';
import { researchStockChangesBacktest } from './backtestStockAgents.js';
import { getForwardReturns } from './forwardReturn.js';

dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// How many past days (that actually had a qualifying dip) to test.
const TEST_TRADING_DAYS = 30;
// Candidates per day — kept small to control Anthropic + Polygon call volume.
const DIPS_PER_DAY = 2;
// MIN_DOLLAR_VOLUME matches production's filter (see getLargestStockDips call in src/index.ts).
// MIN_MARKET_CAP is deliberately higher than production's $100M floor — testing whether the
// judge's edge holds on larger companies specifically. This means the candidate universe here is
// narrower than what the deployed pipeline actually sees; a result here doesn't say anything
// about the small/micro-cap dips production still picks from. $10B was tried first but made the
// market-cap scan (getLargestStockDips checks tickers one at a time, ranked by % drop) impractically
// slow — true mega-caps rarely show up among the day's biggest percentage droppers, so the scan
// could run for a very long time or exhaust the day's candidates without finding any. $2B is
// still meaningfully "larger companies" while staying common enough among daily droppers to scan
// in reasonable time.
const MIN_DOLLAR_VOLUME = 10_000_000;
const MIN_MARKET_CAP = 2_000_000_000;
// Holding periods to score a pick against. Primary metric is HORIZONS[0] — the bull/bear
// reasoning is anchored to a specific catalyst on a specific day, and that catalyst's
// relevance to price fades fast, so "a week" (5 trading days) is closer to what the judge is
// actually reasoning about than "a month" (20 trading days), where unrelated news has usually
// taken over as the main driver. 1-day is included to see whether the judge's edge is even
// stronger right next to the catalyst — additional context only, not primary (changing primary
// post-hoc based on which horizon looks best in a given run is exactly the p-hacking this
// backtest is designed to avoid). All horizons are reported at no extra API cost, since
// getForwardReturns covers every horizon from one Polygon call.
const HORIZONS = [5, 1, 20];
// Most recent date considered, so the longest horizon's price history already exists.
const END_DATE_BUFFER_DAYS = Math.max(...HORIZONS) + 10;
// How far back candidate dates can be sampled from. A contiguous recent window is really one
// market regime — every test day shares whatever conditions happened to hold that stretch.
// Sampling randomly across a full year spreads days across different regimes (calm/volatile,
// up/down markets), so a good (or bad) result is harder to explain away as "just a good month."
const LOOKBACK_WINDOW_DAYS = 365;
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
// baseline. See BACKLOG.md.
const MARKET_CONTEXT_PLACEHOLDER = 'Backtest mode: broad market-context research is omitted here — it would require live web_search, which cannot be restricted to a historical date without leaking post-date information.';

interface DayResult {
  date: string;
  candidates: { ticker: string; returns: Map<number, number> }[];
  pickTicker: string | undefined;
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

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
    const { qualifying: dips } = await getLargestStockDips(testDate, DIPS_PER_DAY, MIN_DOLLAR_VOLUME, MIN_MARKET_CAP);
    if (dips.length === 0) {
      console.log('No qualifying dips (weekend/holiday/no data) — skipping.');
      continue;
    }

    const research = await researchStockChangesBacktest(client, dips, MARKET_CONTEXT_PLACEHOLDER, testDate);
    const picks = await pickStock(client, research, testDate);
    const pickTicker = picks[0]?.ticker;

    const candidates: DayResult['candidates'] = [];
    for (const dip of dips) {
      const forward = await getForwardReturns(dip.ticker, testDate, HORIZONS);
      const returns = new Map<number, number>();
      for (const [horizon, fr] of forward ?? []) returns.set(horizon, fr.pctReturn);
      candidates.push({ ticker: dip.ticker, returns });
      const summary = HORIZONS.map(h => `${h}d: ${returns.has(h) ? returns.get(h)!.toFixed(2) + '%' : 'unavailable'}`).join(', ');
      console.log(`  ${dip.ticker}: dropped ${dip.percentageChange.toFixed(2)}%, forward returns — ${summary}`);
    }

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

  for (const horizon of HORIZONS) {
    const allCandidateReturns = results.flatMap(r => r.candidates.map(c => c.returns.get(horizon))).filter((r): r is number => r !== undefined);
    const pickReturns = results
      .map(r => r.pickTicker ? r.candidates.find(c => c.ticker === r.pickTicker)?.returns.get(horizon) : undefined)
      .filter((r): r is number => r !== undefined);

    const label = horizon === HORIZONS[0] ? `${horizon}-day (primary)` : `${horizon}-day`;
    console.log(`\n[${label}]`);
    console.log(`  Baseline (every qualifying dip) avg return: ${avg(allCandidateReturns)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(allCandidateReturns) ?? 0) * 100).toFixed(0)}%, n=${allCandidateReturns.length})`);
    console.log(`  Judge picks avg return: ${avg(pickReturns)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(pickReturns) ?? 0) * 100).toFixed(0)}%, n=${pickReturns.length})`);
  }

  console.log(`\nTotal Claude API cost: $${getTotalCost().toFixed(4)}`);
}

main().catch(console.error);
