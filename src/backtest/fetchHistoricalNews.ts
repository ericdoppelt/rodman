import axios from 'axios';
import { polygonNewsResponseSchema, type PolygonNewsItem } from '../schemas.js';
import { throttlePolygonCall } from '../rateLimit.js';

function _formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fetches news articles about a ticker published on or before `beforeDate`, using Polygon's
 * `published_utc.lte` filter. This is the point-in-time-safe substitute for `web_search` in
 * backtest mode: unlike a live search, results here cannot include anything published after
 * the historical date being analyzed.
 */
export async function getHistoricalNews(ticker: string, beforeDate: Date, limit = 5): Promise<PolygonNewsItem[]> {
  const endpoint = 'https://api.polygon.io/v2/reference/news';
  await throttlePolygonCall();
  const response = await axios.get(endpoint, {
    params: {
      ticker,
      'published_utc.lte': _formatDate(beforeDate),
      order: 'desc',
      sort: 'published_utc',
      limit,
      apiKey: process.env.MASSIVE_API_KEY,
    },
  }).catch(error => {
    console.error(`Failed to fetch historical news for ${ticker}`, error);
    throw error;
  });

  const parsed = polygonNewsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Polygon news response did not match expected shape for ${ticker}: ${parsed.error.message}`);
  }

  return parsed.data.results;
}
