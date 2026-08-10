import dotenv from 'dotenv';
import { getLargestStockDips } from '../fetchTopDips.js';
import { getForwardReturns, type ForwardReturn } from './forwardReturn.js';
import { staticTickerDetailsLookup } from './staticMarketCap.js';
import { getHistoricalMarketNews } from './fetchHistoricalMarketNews.js';
import { getHistoricalNews } from './fetchHistoricalNews.js';
import { readDailyCache, writeDailyCache, hasCompleteForwardReturns, isNonTradingDay } from './dailyCache.js';
import type { NewsItem } from '../schemas.js';
import {
  DIPS_PER_DAY,
  MARKET_NEWS_LIMIT,
  MIN_DOLLAR_VOLUME,
  MIN_MARKET_CAP,
  HORIZONS,
  END_DATE_BUFFER_DAYS,
  LOOKBACK_WINDOW_DAYS,
} from './backtestConfig.js';

dotenv.config();

// Populates data/backtest-cache/ for every calendar day in runBacktest.ts's sampling window
// (same LOOKBACK_WINDOW_DAYS / END_DATE_BUFFER_DAYS / candidate criteria, imported from
// backtestConfig.ts so a warmed cache always matches what a real run would ask for) — including
// forward returns, which runBacktest.ts previously always re-fetched live even on a cache hit.
// No Claude calls here at all: this only touches Polygon (dip scan, forward returns) and Tavily
// (market + per-ticker news), so it's free to run at any size. Safe to interrupt and rerun — each
// date is checked against the cache and skipped if already warmed, so progress isn't lost.
//
// Weekends/holidays and days with zero qualifying dips are cached too (as an empty entry), so a
// future backtest run's random date sampling never re-pays the Polygon dip-scan call for a date
// already confirmed to have nothing — see runBacktest.ts's cached-path handling of dips.length === 0.

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set');

  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - LOOKBACK_WINDOW_DAYS);
  earliestDate.setHours(0, 0, 0, 0);
  const latestDate = new Date();
  latestDate.setDate(latestDate.getDate() - END_DATE_BUFFER_DAYS);
  latestDate.setHours(0, 0, 0, 0);

  const totalDays = Math.round((latestDate.getTime() - earliestDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  console.log(`Warming cache for ${totalDays} calendar days: ${earliestDate.toISOString().slice(0, 10)} to ${latestDate.toISOString().slice(0, 10)}`);

  let warmed = 0;
  let backfilled = 0;
  let skipped = 0;
  let empty = 0;
  const startedAt = Date.now();

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(earliestDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().slice(0, 10);

    // Markets are closed, and Polygon's grouped endpoint doesn't reliably say so — it sometimes
    // returns the prior session's bars, which would then be cached under this date. Record the
    // empty result without calling Polygon at all. See isNonTradingDay in dailyCache.ts.
    if (isNonTradingDay(dateKey)) {
      if (!readDailyCache(dateKey)) {
        writeDailyCache(dateKey, { dips: [], allResults: [], marketNews: [], perTickerNews: {}, forwardReturns: {} });
        empty++;
      } else {
        skipped++;
      }
      continue;
    }

    const existing = readDailyCache(dateKey);
    if (existing && hasCompleteForwardReturns(existing, HORIZONS)) {
      skipped++;
      continue;
    }

    if (existing) {
      // Raw dips/news are still valid (model-independent) — only the forward returns are stale,
      // because a horizon was added to HORIZONS since this date was cached. Re-fetch just those.
      const forwardReturns: Record<string, Record<number, ForwardReturn>> = {};
      await Promise.all(existing.dips.map(async dip => {
        const forward = await getForwardReturns(dip.ticker, date, HORIZONS);
        if (forward) forwardReturns[dip.ticker] = Object.fromEntries(forward);
      }));
      writeDailyCache(dateKey, { ...existing, forwardReturns });
      backfilled++;
      console.log(`[${i + 1}/${totalDays}] ${dateKey}: backfilled forward returns for horizons ${HORIZONS.join(',')}`);
      continue;
    }

    const fetched = await getLargestStockDips(date, DIPS_PER_DAY, MIN_DOLLAR_VOLUME, MIN_MARKET_CAP, staticTickerDetailsLookup);
    const dips = fetched.qualifying;

    if (dips.length === 0) {
      // Weekend/holiday/no qualifying dips — cache the empty result so future runs skip Polygon
      // for this date too, instead of just skipping the write like the live runBacktest.ts path.
      writeDailyCache(dateKey, { dips: [], allResults: fetched.allResults, marketNews: [], perTickerNews: {}, forwardReturns: {} });
      empty++;
      console.log(`[${i + 1}/${totalDays}] ${dateKey}: no qualifying dips — cached empty`);
      continue;
    }

    const [marketNews, perTickerNewsEntries, forwardReturnsEntries] = await Promise.all([
      getHistoricalMarketNews(date, MARKET_NEWS_LIMIT),
      Promise.all(dips.map(async dip => [dip.ticker, await getHistoricalNews(dip.ticker, date)] as const)),
      Promise.all(dips.map(async dip => [dip.ticker, await getForwardReturns(dip.ticker, date, HORIZONS)] as const)),
    ]);

    const perTickerNews: Record<string, NewsItem[]> = Object.fromEntries(perTickerNewsEntries);
    const forwardReturns: Record<string, Record<number, ForwardReturn>> = {};
    for (const [ticker, forward] of forwardReturnsEntries) {
      if (forward) forwardReturns[ticker] = Object.fromEntries(forward);
    }

    writeDailyCache(dateKey, { dips, allResults: fetched.allResults, marketNews, perTickerNews, forwardReturns });
    warmed++;
    console.log(`[${i + 1}/${totalDays}] ${dateKey}: ${dips.length} qualifying dip(s) — cached`);
  }

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\nDone in ${elapsedMin} min. Warmed: ${warmed}, backfilled (forward returns only): ${backfilled}, already cached (skipped): ${skipped}, empty (weekend/holiday/no dips): ${empty}.`);
}

main().catch(console.error);
