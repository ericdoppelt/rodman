import { tavilySearch } from './fetchTavily.js';
import type { NewsItem } from '../schemas.js';

/**
 * Fetches general market news (no ticker filter) published on or before `beforeDate`, using the
 * same point-in-time-safe Tavily `end_date` filter as getHistoricalNews. Used to build the
 * backtest's market-context block from real, dated headlines instead of an AI-written summary —
 * see docs/decisions/0004-point-in-time-market-context-for-backtest.md.
 */
export async function getHistoricalMarketNews(beforeDate: Date, limit = 20): Promise<NewsItem[]> {
  return tavilySearch('US stock market', beforeDate, limit);
}
