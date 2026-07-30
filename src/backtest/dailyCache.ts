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

export function readDailyCache(dateKey: string): DailyCacheEntry | undefined {
  const path = _pathFor(dateKey);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeDailyCache(dateKey: string, entry: DailyCacheEntry): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(_pathFor(dateKey), JSON.stringify(entry, null, 2));
}
