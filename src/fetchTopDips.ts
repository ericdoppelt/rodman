import axios from 'axios';
import { apiResponseSchema, tickerDetailsResponseSchema, type StockResult, type StockChange } from './schemas.js';
import { polygonRequest } from './rateLimit.js';

function _formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function _queryStockDataForDate(date: Date): Promise<StockResult[]> {
  const formattedDate = _formatDate(date);
  const endpoint = 'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/' + formattedDate;
  const response = await polygonRequest(() => axios.get(endpoint, {
    params: {
      adjusted: true,
      apiKey: process.env.MASSIVE_API_KEY,
    },
  })).catch(error => {
    console.error('Failed to fetch stock data for date:', date, error);
    throw error;
  });

  const parsed = apiResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(
      'Polygon API response did not match expected shape for date ' + formattedDate + ': ' + parsed.error.message
    );
  }

  if (parsed.data.status !== 'OK') {
    throw new Error('Failed to fetch stock data for date ' + date + ' since response status is not OK');
  }

  return parsed.data.results;
}

function _calculatePercentageChange(open: number, close: number): number {
  return ((close - open) / open) * 100;
}

async function _fetchMarketCap(ticker: string): Promise<number | undefined> {
  const endpoint = `https://api.polygon.io/v3/reference/tickers/${ticker}`;
  const response = await polygonRequest(() => axios.get(endpoint, {
    params: {
      apiKey: process.env.MASSIVE_API_KEY,
    },
  })).catch(error => {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null; // ticker not in Polygon's reference DB (delisted/OTC/etc.) — treat as no market cap data
    }
    console.error('Failed to fetch ticker details for', ticker, error);
    throw error;
  });
  if (response === null) return undefined;

  const parsed = tickerDetailsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(
      'Polygon API response did not match expected shape for ticker details of ' + ticker + ': ' + parsed.error.message
    );
  }

  return parsed.data.results.market_cap;
}

function _createStockChanges(results: StockResult[]): StockChange[] {
  return results.map(res => ({
    ticker: res.T,
    open: res.o,
    close: res.c,
    percentageChange: _calculatePercentageChange(res.o, res.c),
    volume: res.v,
  }));
}

function _orderStockDipsDescending(stockChanges: StockChange[]): StockChange[] {
  const filteredStockChanges = stockChanges.filter(sc => sc.percentageChange < 0);
  return filteredStockChanges.sort((a, b) => a.percentageChange - b.percentageChange);
}

/**
 * Exposed function to identify the stocks that have the biggest dip in any given day with a mininum specified dollar volume
 * and, optionally, a minimum market cap.
 * @param date is the date to look at stock changes on.
 * @param minDollarVolume is the minimum traded dollar volume (volume * close price) needed to be eligible as a "largest dropper".
 * @param limit is the maximum number of stocks returned.
 * @param minMarketCap is the minimum market cap needed to be eligible; when set, dips are checked one at a time (in order
 * of largest drop first, rate-limited between calls) until `limit` qualifying stocks are found.
 * @returns StockChange[] which indicates the stocks with the largest drops on the specified day that meet the dollar volume
 * and market cap criteria.
 */
export async function getLargestStockDips(date: Date, limit: number, minDollarVolume?: number, minMarketCap?: number): Promise<StockChange[]> {
  const stockResults = await _queryStockDataForDate(date);
  if (stockResults.length === 0) {
    console.warn('No stock results for date', date.toISOString().slice(0, 10), '(e.g. weekend/holiday or no data)');
    return [];
  }
  const filteredStockResults = (minDollarVolume !== undefined) ? stockResults.filter(sc => sc.v * sc.c >= minDollarVolume) : stockResults;
  const stockChanges = _createStockChanges(filteredStockResults);
  const orderedDips = _orderStockDipsDescending(stockChanges);

  if (minMarketCap === undefined) {
    return orderedDips.slice(0, limit);
  }

  const qualifyingDips: StockChange[] = [];
  for (const stockChange of orderedDips) {
    if (qualifyingDips.length >= limit) break;
    const marketCap = await _fetchMarketCap(stockChange.ticker);
    if (marketCap !== undefined && marketCap >= minMarketCap) {
      qualifyingDips.push(stockChange);
    }
  }
  return qualifyingDips;
}