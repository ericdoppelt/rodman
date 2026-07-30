import axios from 'axios';
import { tavilySearchResponseSchema, type NewsItem } from '../schemas.js';

function _formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Verified empirically (2026-07-30): Tavily silently ignores `end_date` unless `start_date` is
// also present in the request — undocumented, but confirmed by direct testing (end_date-only
// returned results dated months after the cutoff; adding a wide-open start_date fixed it). Set
// far enough back to never exclude real historical news.
const _WIDE_OPEN_START_DATE = '2000-01-01';

/**
 * Point-in-time-safe web search via Tavily's `end_date` filter (server-enforced, unlike Claude's
 * live `web_search` tool which has no date-restriction parameter at all — see
 * docs/decisions/0005-tavily-for-backtest-evidence.md). Replaces the earlier Polygon-news-only
 * evidence source with broader web coverage, closer to what production's live web_search sees.
 * `topic: 'news'` is required to get `published_date` back on each result.
 */
export async function tavilySearch(query: string, beforeDate: Date, limit: number): Promise<NewsItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set');

  const response = await axios.post('https://api.tavily.com/search', {
    query,
    topic: 'news',
    start_date: _WIDE_OPEN_START_DATE,
    end_date: _formatDate(beforeDate),
    max_results: limit,
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(error => {
    console.error(`Tavily search failed for query "${query}"`, error);
    throw error;
  });

  const parsed = tavilySearchResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Tavily response did not match expected shape for query "${query}": ${parsed.error.message}`);
  }

  return parsed.data.results.map(r => ({
    title: r.title,
    description: r.content,
    published_utc: r.published_date ?? _formatDate(beforeDate),
    article_url: r.url,
  }));
}
