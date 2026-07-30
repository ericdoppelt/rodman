import { readFileSync } from 'fs';

// Static ticker -> market cap snapshot (see scripts/updateMarketCapSnapshot.ts) used to filter the
// backtest in-memory instead of Polygon's per-ticker reference endpoint. The live endpoint only
// ever returns *today's* market cap regardless of the date requested, so a slightly stale snapshot
// is the same level of approximation for historical test dates — just without the 12s/ticker
// rate-limit wait. See docs/decisions/0001-static-market-cap-snapshot-for-backtest.md.
const SNAPSHOT_PATH = new URL('../data/market-caps.csv', import.meta.url);

let _cache: Map<string, number> | undefined;

function _loadSnapshot(): Map<string, number> {
  const csv = readFileSync(SNAPSHOT_PATH, 'utf-8');
  const map = new Map<string, number>();
  const lines = csv.split('\n');
  for (const line of lines.slice(1)) { // skip header
    if (!line) continue;
    const [symbol, marketCap] = line.split(',');
    if (!symbol) continue;
    map.set(symbol, Number(marketCap));
  }
  return map;
}

/**
 * Synchronous market-cap lookup backed by the static snapshot, matching the
 * `(ticker) => number | undefined` shape `getLargestStockDips` expects for its `marketCapLookup`
 * override. Loads and caches the whole snapshot on first call.
 */
export function staticMarketCapLookup(ticker: string): number | undefined {
  if (!_cache) _cache = _loadSnapshot();
  return _cache.get(ticker);
}
