import { readFileSync } from 'fs';
import type { TickerDetails } from '../schemas.js';

// Static ticker -> market cap snapshot (see scripts/updateMarketCapSnapshot.ts) used to filter the
// backtest in-memory instead of Polygon's per-ticker reference endpoint. The live endpoint only
// ever returns *today's* market cap regardless of the date requested, so a slightly stale snapshot
// is the same level of approximation for historical test dates — just without the 12s/ticker
// rate-limit wait. See docs/decisions/0001-static-market-cap-snapshot-for-backtest.md.
const SNAPSHOT_PATH = new URL('../data/market-caps.csv', import.meta.url);

let _cache: Map<string, TickerDetails> | undefined;

// `name` is the last column precisely because company names contain commas ("BillionToOne, Inc."),
// so it is written quoted and parsed as "everything after the second comma" rather than by splitting.
function _parseName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/""/g, '"')
    : trimmed;
  return unquoted || undefined;
}

function _loadSnapshot(): Map<string, TickerDetails> {
  const csv = readFileSync(SNAPSHOT_PATH, 'utf-8');
  const map = new Map<string, TickerDetails>();
  const lines = csv.split('\n');
  for (const line of lines.slice(1)) { // skip header
    if (!line) continue;
    const firstComma = line.indexOf(',');
    if (firstComma === -1) continue;
    const symbol = line.slice(0, firstComma);
    if (!symbol) continue;
    const rest = line.slice(firstComma + 1);
    const secondComma = rest.indexOf(',');
    // Snapshots written before names were added have only two columns — still valid, name is undefined.
    const marketCap = secondComma === -1 ? rest : rest.slice(0, secondComma);
    const name = secondComma === -1 ? undefined : _parseName(rest.slice(secondComma + 1));
    map.set(symbol, { marketCap: Number(marketCap), name });
  }
  return map;
}

/**
 * Synchronous ticker-details lookup backed by the static snapshot, matching the
 * `(ticker) => TickerDetails` shape `getLargestStockDips` expects for its `detailsLookup`
 * override. Loads and caches the whole snapshot on first call.
 */
export function staticTickerDetailsLookup(ticker: string): TickerDetails {
  if (!_cache) _cache = _loadSnapshot();
  return _cache.get(ticker) ?? {};
}
