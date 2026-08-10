import dotenv from 'dotenv';
import { readDailyCache, writeDailyCache } from '../src/backtest/dailyCache.js';
import { getHistoricalMarketNews } from '../src/backtest/fetchHistoricalMarketNews.js';
import { getHistoricalNews } from '../src/backtest/fetchHistoricalNews.js';
import { staticTickerDetailsLookup } from '../src/backtest/staticMarketCap.js';
import { MARKET_NEWS_LIMIT } from '../src/backtest/backtestConfig.js';

dotenv.config();

// Re-fetches only the Tavily-sourced fields of an existing daily cache entry, leaving the Polygon
// data (dips' price fields, allResults, forwardReturns) untouched. Needed because cached entries
// hold evidence gathered under the *old* query shape — bare ticker, topic 'news', no search_depth,
// and a start_date of 2000-01-01 — which is what let common-word tickers (BULL, CAR, Q) match
// articles about unrelated companies and let genuinely-matched tickers return months-stale news.
// See BACKLOG.md's Tavily item.
//
// Dips are also re-stamped with companyName, which cached entries predate: without it the new
// name-qualified query silently degrades back to the bare-ticker form it is meant to replace.
//
// Takes dates explicitly rather than re-deriving runBacktest.ts's sampled set. That sampler keys
// off `new Date()` without normalizing to midnight, so the same seed maps to slightly different
// dates as the clock advances — replicating it here would risk refreshing dates the run won't use.
//
// Usage: pnpm tsx scripts/refreshBacktestNews.ts 2025-04-24 2025-04-01 ...
// Costs 2 Tavily credits per call (search_depth 'advanced'), 1 + DIPS_PER_DAY calls per date.

async function main() {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set');

  const dateKeys = process.argv.slice(2).filter(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  if (dateKeys.length === 0) throw new Error('Pass one or more YYYY-MM-DD dates to refresh');

  let refreshed = 0;
  let named = 0;
  let calls = 0;

  for (const [index, dateKey] of dateKeys.entries()) {
    const existing = readDailyCache(dateKey);
    if (!existing) {
      console.warn(`[${index + 1}/${dateKeys.length}] ${dateKey}: no cache entry — skipping (a run will fetch it fresh)`);
      continue;
    }
    if (existing.dips.length === 0) {
      console.log(`[${index + 1}/${dateKeys.length}] ${dateKey}: no qualifying dips — nothing to refresh`);
      continue;
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);

    const dips = existing.dips.map(dip => {
      const { name } = staticTickerDetailsLookup(dip.ticker);
      if (name) named++;
      return { ...dip, companyName: name };
    });

    const [marketNews, perTickerEntries] = await Promise.all([
      getHistoricalMarketNews(date, MARKET_NEWS_LIMIT),
      Promise.all(dips.map(async dip => [dip.ticker, await getHistoricalNews(dip.ticker, date, undefined, dip.companyName)] as const)),
    ]);
    calls += 1 + dips.length;

    const perTickerNews = Object.fromEntries(perTickerEntries);
    writeDailyCache(dateKey, { ...existing, dips, marketNews, perTickerNews });
    refreshed++;

    const empties = perTickerEntries.filter(([, news]) => news.length === 0).map(([ticker]) => ticker);
    console.log(
      `[${index + 1}/${dateKeys.length}] ${dateKey}: ${dips.length} dips, ${marketNews.length} market articles` +
      (empties.length > 0 ? `, no results for ${empties.join(', ')}` : '')
    );
  }

  console.log(`\nRefreshed ${refreshed} dates — ${named} dips stamped with a company name, ${calls} Tavily calls (~${calls * 2} credits).`);
}

main().catch(error => {
  console.error('Failed to refresh backtest news:', error);
  process.exit(1);
});
