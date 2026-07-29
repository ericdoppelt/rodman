import axios from 'axios';
import { tickerRangeAggsResponseSchema } from '../schemas.js';
import { polygonRequest } from '../rateLimit.js';

function _formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ForwardReturn {
  fromClose: number;
  toClose: number;
  toDate: string;
  pctReturn: number;
}

/**
 * Fetches the close price on `fromDate` and the close price at each horizon in
 * `tradingDaysAheadList` (e.g. [5, 20] for "a week" and "a month"), for a single ticker, using
 * one Polygon per-ticker daily range call that covers the widest horizon requested — so
 * checking multiple holding periods costs no extra API calls.
 * @returns a map from horizon -> return, omitting horizons without enough trading-day history
 * yet; undefined if there's no data at all (e.g. the range starts on a non-trading day).
 */
export async function getForwardReturns(ticker: string, fromDate: Date, tradingDaysAheadList: number[]): Promise<Map<number, ForwardReturn> | undefined> {
  const maxHorizon = Math.max(...tradingDaysAheadList);
  const toDate = new Date(fromDate);
  // Overshoot the calendar window (weekends/holidays) to guarantee enough trading days are covered.
  toDate.setDate(toDate.getDate() + Math.ceil(maxHorizon * 1.6) + 5);

  const endpoint = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${_formatDate(fromDate)}/${_formatDate(toDate)}`;
  const response = await polygonRequest(() => axios.get(endpoint, {
    params: {
      adjusted: true,
      sort: 'asc',
      apiKey: process.env.MASSIVE_API_KEY,
    },
  })).catch(error => {
    console.error(`Failed to fetch forward-return range for ${ticker}`, error);
    throw error;
  });

  const parsed = tickerRangeAggsResponseSchema.safeParse(response.data);
  if (!parsed.success || parsed.data.results.length === 0) {
    console.warn(`No aggs returned for ${ticker} starting ${_formatDate(fromDate)}`);
    return undefined;
  }

  const bars = parsed.data.results;
  const fromBar = bars[0];
  if (!fromBar) {
    return undefined;
  }

  const returns = new Map<number, ForwardReturn>();
  for (const horizon of tradingDaysAheadList) {
    const toIndex = Math.min(horizon, bars.length - 1);
    const toBar = bars[toIndex];
    if (!toBar || toIndex === 0) {
      console.warn(`Not enough trading-day history for ${ticker} to reach the ${horizon}-day horizon yet`);
      continue;
    }
    returns.set(horizon, {
      fromClose: fromBar.c,
      toClose: toBar.c,
      toDate: new Date(toBar.t).toISOString().slice(0, 10),
      pctReturn: ((toBar.c - fromBar.c) / fromBar.c) * 100,
    });
  }

  return returns.size > 0 ? returns : undefined;
}
