import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { StockChange, StockResult, NewsItem } from '../schemas.js';
import type { ForwardReturn } from './forwardReturn.js';

// Raw, model-independent inputs for one test date (dip candidates, index/sector snapshot data,
// news, and forward returns) persisted to disk after the first fetch. Bull/bear/judge outputs are
// NEVER cached here — those must regenerate fresh every run so different model configs stay
// comparable against the same fixed evidence. See docs/decisions/0005-tavily-for-backtest-evidence.md.
// Forward returns are historical price data (fixed once the date has passed), so unlike bull/bear
// output they're safe to cache permanently — caching them is what lets a scoring run skip Polygon
// entirely on a cache hit, which is what makes parallelizing the day loop actually fast instead of
// still bottlenecked on Polygon's 12s/call spacing (see rateLimit.ts).
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/backtest-cache');

export interface DailyCacheEntry {
  dips: StockChange[];
  allResults: StockResult[];
  marketNews: NewsItem[];
  perTickerNews: Record<string, NewsItem[]>;
  // ticker -> horizon (trading days ahead) -> return. Absent/undefined for cache entries written
  // before forward-return caching was added — callers should fall back to a live fetch in that case.
  forwardReturns?: Record<string, Record<number, ForwardReturn>>;
}

function _pathFor(dateKey: string): string {
  return join(CACHE_DIR, `${dateKey}.json`);
}

// NYSE full-day closures. Half sessions (the day after Thanksgiving, Christmas Eve) are real
// trading days and deliberately absent. Extend this when the sampling window moves past 2026.
const MARKET_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

/**
 * True for dates the US market was closed — weekends and full-day holidays.
 *
 * Polygon's grouped-daily endpoint cannot be trusted to return an empty result for these. Of 151
 * cached weekend dates, 18 came back with bars; Thanksgiving and Christmas 2025 each came back
 * with ~11.6k rows. That data isn't a copy of an adjacent session either (the hashes differ), so
 * there is no way to detect it from the payload — hence an explicit calendar. Labor Day 2025 did
 * come back empty, so the behavior isn't even consistent day to day.
 *
 * A date like this looks like an ordinary test day — it has four qualifying dips — but its
 * candidates are junk while forward returns are measured from a date the market never traded on.
 * Sampling and cache warming both skip these rather than trusting the endpoint.
 *
 * Reads the day-of-week in UTC from the date key itself, which is how cache entries are keyed —
 * deriving it from a local-midnight Date would disagree across timezones.
 */
export function isNonTradingDay(dateKey: string): boolean {
  if (MARKET_HOLIDAYS.has(dateKey)) return true;
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function readDailyCache(dateKey: string): DailyCacheEntry | undefined {
  const path = _pathFor(dateKey);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeDailyCache(dateKey: string, entry: DailyCacheEntry): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(_pathFor(dateKey), JSON.stringify(entry, null, 2));
}

// True if every dip candidate's cached forward returns already cover every horizon currently
// configured. False when a horizon was added to HORIZONS after this date was cached — e.g. an
// entry cached back when HORIZONS topped out at 20 days has no way to answer a 252-day horizon,
// since getForwardReturns' single Polygon call only fetched bars out to the widest horizon
// requested *at fetch time*. Callers use this to backfill just the missing forward returns
// instead of re-fetching dips/news that haven't changed.
export function hasCompleteForwardReturns(entry: DailyCacheEntry, horizons: number[]): boolean {
  if (!entry.forwardReturns) return entry.dips.length === 0;
  const forwardReturns = entry.forwardReturns;
  return entry.dips.every(dip => {
    const fr = forwardReturns[dip.ticker];
    return fr !== undefined && horizons.every(h => h in fr);
  });
}
