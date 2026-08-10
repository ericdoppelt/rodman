import { tavilySearch } from './fetchTavily.js';
import type { NewsItem } from '../schemas.js';

/**
 * Fetches news articles about a ticker published on or before `beforeDate`, via Tavily's
 * `end_date` filter. This is the point-in-time-safe substitute for `web_search` in backtest
 * mode: unlike a live search, results here cannot include anything published after the
 * historical date being analyzed.
 *
 * `companyName` matters more than it looks: querying the bare ticker made short or common-word
 * symbols collide with ordinary English — BULL returned generic "bull market" commentary, TDTH
 * returned unrelated microcaps — so roughly a third of sampled tickers were being judged on
 * evidence about some other company entirely.
 */
export async function getHistoricalNews(ticker: string, beforeDate: Date, limit = 5, companyName?: string): Promise<NewsItem[]> {
  const query = companyName ? `${companyName} (${ticker}) stock` : `${ticker} stock`;
  return tavilySearch(query, beforeDate, limit);
}
