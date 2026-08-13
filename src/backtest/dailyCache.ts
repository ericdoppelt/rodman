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

// Re-exported so backtest callers keep importing it from here. The calendar itself lives in
// src/marketCalendar.ts because production needs it too — fetchTopDips walks back to the previous
// session to compute the overnight gap, and must skip the same closed days for the same reason.
export { isNonTradingDay } from '../marketCalendar.js';

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
