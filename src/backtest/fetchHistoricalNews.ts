import { tavilySearch } from './fetchTavily.js';
import type { NewsItem } from '../schemas.js';

/**
 * Fetches news articles about a ticker published on or before `beforeDate`, via Tavily's
 * `end_date` filter. This is the point-in-time-safe substitute for `web_search` in backtest
 * mode: unlike a live search, results here cannot include anything published after the
 * historical date being analyzed.
 */
export async function getHistoricalNews(ticker: string, beforeDate: Date, limit = 5): Promise<NewsItem[]> {
  return tavilySearch(`${ticker} stock`, beforeDate, limit);
}
