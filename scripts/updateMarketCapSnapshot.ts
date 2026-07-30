import axios from 'axios';
import { writeFileSync } from 'fs';

// Refreshes src/data/market-caps.csv from Nasdaq's public stock-screener endpoint, which returns
// market cap for every listed ticker in one request — no per-ticker calls, no rate limit. Used to
// seed the static snapshot that the backtest filters against instead of Polygon's per-ticker
// reference endpoint (see docs/decisions/0001-static-market-cap-snapshot-for-backtest.md).
const NASDAQ_SCREENER_ENDPOINT = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=1&offset=0&download=true';
const OUTPUT_PATH = new URL('../src/data/market-caps.csv', import.meta.url);

interface NasdaqRow {
  symbol: string;
  marketCap: string;
}

async function main() {
  const response = await axios.get(NASDAQ_SCREENER_ENDPOINT, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  const rows: NasdaqRow[] = response.data?.data?.rows ?? [];
  if (rows.length === 0) throw new Error('Nasdaq screener returned no rows');

  const seen = new Set<string>();
  const entries: [string, number][] = [];
  for (const row of rows) {
    const symbol = row.symbol?.trim();
    if (!symbol || seen.has(symbol)) continue;
    const marketCap = Number(row.marketCap);
    if (!Number.isFinite(marketCap) || marketCap <= 0) continue;
    seen.add(symbol);
    entries.push([symbol, Math.round(marketCap)]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));

  const csv = ['symbol,marketCap', ...entries.map(([symbol, cap]) => `${symbol},${cap}`)].join('\n') + '\n';
  writeFileSync(OUTPUT_PATH, csv);
  console.log(`Wrote ${entries.length} tickers (of ${rows.length} in the raw feed) to ${OUTPUT_PATH.pathname}`);
}

main().catch(error => {
  console.error('Failed to update market-cap snapshot:', error);
  process.exit(1);
});
