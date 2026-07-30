import type { StockResult, NewsItem } from '../schemas.js';

// Broad indices + the 11 sector SPDRs. Looked up directly in the day's already-fetched grouped-daily
// results (same call getLargestStockDips uses to find dips), so this costs zero extra Polygon calls.
const INDEX_AND_SECTOR_TICKERS: [ticker: string, label: string][] = [
  ['SPY', 'S&P 500'],
  ['QQQ', 'Nasdaq 100'],
  ['DIA', 'Dow'],
  ['XLK', 'Technology'],
  ['XLE', 'Energy'],
  ['XLF', 'Financials'],
  ['XLV', 'Health Care'],
  ['XLY', 'Consumer Discretionary'],
  ['XLP', 'Consumer Staples'],
  ['XLI', 'Industrials'],
  ['XLB', 'Materials'],
  ['XLU', 'Utilities'],
  ['XLRE', 'Real Estate'],
  ['XLC', 'Communication Services'],
];

function _buildIndexSnapshot(allResults: StockResult[]): string {
  const byTicker = new Map(allResults.map(r => [r.T, r]));
  const lines = INDEX_AND_SECTOR_TICKERS
    .map(([ticker, label]) => {
      const result = byTicker.get(ticker);
      if (!result) return undefined;
      const pctChange = ((result.c - result.o) / result.o) * 100;
      return `${label} (${ticker}): ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`;
    })
    .filter((line): line is string => line !== undefined);
  return lines.length > 0 ? lines.join(' | ') : '(no index/sector data available for this day)';
}

function _buildNewsBlock(news: NewsItem[]): string {
  if (news.length === 0) return '(no general market news found on or before this date)';
  return news.map(n => `- [${n.published_utc.slice(0, 10)}] ${n.title}${n.description ? ` — ${n.description}` : ''}`).join('\n');
}

/**
 * Builds the backtest's point-in-time market-context block from raw retrieved facts — index/sector
 * price moves (from the day's grouped-daily results) and real market-news headlines — handed to
 * bull/bear as-is, with no AI-generated summarization step in between. See
 * docs/decisions/0004-point-in-time-market-context-for-backtest.md for why: an LLM asked to
 * "summarize what happened" can lean on memorized knowledge of well-covered macro events rather
 * than the retrieved evidence, which the published_utc.lte filter does nothing to prevent.
 */
export function buildMarketContext(date: Date, allResults: StockResult[], news: NewsItem[]): string {
  const formattedDate = date.toISOString().split('T')[0];
  return `Market conditions on ${formattedDate}:\n${_buildIndexSnapshot(allResults)}\n\nMarket news published on or before ${formattedDate}:\n${_buildNewsBlock(news)}`;
}
