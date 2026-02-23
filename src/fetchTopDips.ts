import axios from 'axios';
import { apiResponseSchema, type StockResult, type StockChange } from './schemas.js';

function _formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function _queryStockDataForDate(date: Date): Promise<StockResult[]> {
  const formattedDate = _formatDate(date);
  const endpoint = 'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/' + formattedDate;
  const response = await axios.get(endpoint, {
    params: {
      adjusted: true,
      apiKey: process.env.MASSIVE_API_KEY,
    },
  }).catch(error => {
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

function _createStockChanges(results: StockResult[]): StockChange[] {
  return results.map(res => ({
    ticker: res.T,
    open: res.o,
    close: res.c,
    percentageChange: _calculatePercentageChange(res.o, res.c),
    volume: res.v,
  }));
}

function _findLargestStockDips(stockChanges: StockChange[], limit: number): StockChange[] {
  const filteredStockChanges = stockChanges.filter(sc => sc.percentageChange < 0);
  const orderedStockChanges = filteredStockChanges.sort((a, b) => a.percentageChange - b.percentageChange);
  return orderedStockChanges.slice(0, limit);
}

/**
 * Exposed function to identify the stocks that have the biggest dip in any given day with a mininum specified volume.
 * @param date is the date to look at stock changes on.
 * @param minVolume is the minimum traded volume needed to be eligible as a "largest dropper".
 * @param limit is the maximum number of stocks returned.
 * @returns StockChange[] which indicates the stocks with the largest drops on the specified day that meet the volume criteria.
 */
export async function getLargestStockDips(date: Date, limit: number, minVolume?: number): Promise<StockChange[]> {
  const stockResults = await _queryStockDataForDate(date);
  if (stockResults.length === 0) {
    console.warn('No stock results for date', date.toISOString().slice(0, 10), '(e.g. weekend/holiday or no data)');
    return [];
  }
  const filteredStockResults = (minVolume !== undefined) ? stockResults.filter(sc => sc.v >= minVolume) : stockResults;
  const stockChanges = _createStockChanges(filteredStockResults);
  return _findLargestStockDips(stockChanges, limit);
}