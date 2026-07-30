import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { StockChange, StockResult, NewsItem } from '../schemas.js';

// Raw, model-independent inputs for one test date (dip candidates, index/sector snapshot data,
// and news) persisted to disk after the first fetch. Bull/bear/judge outputs are NEVER cached
// here — those must regenerate fresh every run so different model configs stay comparable
// against the same fixed evidence. See docs/decisions/0005-tavily-for-backtest-evidence.md.
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/backtest-cache');

export interface DailyCacheEntry {
  dips: StockChange[];
  allResults: StockResult[];
  marketNews: NewsItem[];
  perTickerNews: Record<string, NewsItem[]>;
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
