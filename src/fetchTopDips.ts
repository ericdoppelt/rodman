import axios from 'axios';
import { apiResponseSchema, tickerDetailsResponseSchema, type StockResult, type StockChange, type RejectedCandidate, type TickerDetails } from './schemas.js';
import { polygonRequest } from './rateLimit.js';
import { previousTradingDay } from './marketCalendar.js';

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

async function _fetchTickerDetails(ticker: string): Promise<TickerDetails> {
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
  if (response === null) return {};

  const parsed = tickerDetailsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(
      'Polygon API response did not match expected shape for ticker details of ' + ticker + ': ' + parsed.error.message
    );
  }

  return { marketCap: parsed.data.results.market_cap, name: parsed.data.results.name };
}

function _createStockChanges(results: StockResult[], previousCloses: Map<string, number>): StockChange[] {
  return results.map(res => ({
    ticker: res.T,
    open: res.o,
    close: res.c,
    percentageChange: _calculatePercentageChange(res.o, res.c),
    volume: res.v,
    previousClose: previousCloses.get(res.T),
  }));
}

/**
 * Closes from the session before `date`, keyed by ticker, for computing each candidate's overnight
 * gap. One extra grouped-daily call per run. Returns an empty map rather than throwing if that
 * session can't be fetched: the gap is context for the prompt, not something ranking depends on,
 * so losing it should degrade the analysis rather than fail the run.
 */
async function _fetchPreviousCloses(date: Date): Promise<Map<string, number>> {
  const previous = previousTradingDay(date);
  if (!previous) return new Map();
  const results = await _queryStockDataForDate(previous).catch(error => {
    console.warn('Could not fetch previous session for gap calculation:', error instanceof Error ? error.message : error);
    return [] as StockResult[];
  });
  return new Map(results.map(res => [res.T, res.c]));
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
 * @param detailsLookup overrides how per-ticker reference data (market cap and company name) is looked up
 * (defaults to the live, rate-limited Polygon call). The backtest passes a synchronous static-snapshot lookup
 * instead, since Polygon's endpoint only ever returns today's market cap regardless of the date requested
 * anyway — see staticMarketCap.ts. The company name is what lets downstream search steps qualify a query with
 * the real company ("BillionToOne") instead of guessing from an ambiguous ticker ("BLLN").
 * @returns `qualifying` StockChange[] with the largest drops that meet the dollar volume and market cap criteria,
 * `rejected` candidates from the market-cap scan (and why each was excluded) for traceability, and `allResults`
 * (every ticker's raw OHLCV for the day, unfiltered) so callers can derive other same-day facts — e.g. the
 * backtest's market-context snapshot — without an extra Polygon call.
 */
export async function getLargestStockDips(
  date: Date,
  limit: number,
  minDollarVolume?: number,
  minMarketCap?: number,
  detailsLookup: (ticker: string) => Promise<TickerDetails> | TickerDetails = _fetchTickerDetails,
): Promise<{ qualifying: StockChange[]; rejected: RejectedCandidate[]; allResults: StockResult[] }> {
  const stockResults = await _queryStockDataForDate(date);
  if (stockResults.length === 0) {
    console.warn('No stock results for date', date.toISOString().slice(0, 10), '(e.g. weekend/holiday or no data)');
    return { qualifying: [], rejected: [], allResults: [] };
  }
  const filteredStockResults = (minDollarVolume !== undefined) ? stockResults.filter(sc => sc.v * sc.c >= minDollarVolume) : stockResults;
  const previousCloses = await _fetchPreviousCloses(date);
  const stockChanges = _createStockChanges(filteredStockResults, previousCloses);
  const orderedDips = _orderStockDipsDescending(stockChanges);

  if (minMarketCap === undefined) {
    return { qualifying: orderedDips.slice(0, limit), rejected: [], allResults: stockResults };
  }

  const qualifyingDips: StockChange[] = [];
  const rejected: RejectedCandidate[] = [];
  for (const stockChange of orderedDips) {
    if (qualifyingDips.length >= limit) break;
    const { marketCap, name } = await detailsLookup(stockChange.ticker);
    if (marketCap !== undefined && marketCap >= minMarketCap) {
      qualifyingDips.push({ ...stockChange, companyName: name });
    } else {
      rejected.push({
        ticker: stockChange.ticker,
        reason: marketCap === undefined ? 'no_market_cap_data' : 'below_min_market_cap',
        details: { percentageChange: stockChange.percentageChange, marketCap: marketCap ?? null, minMarketCap },
      });
    }
  }
  return { qualifying: qualifyingDips, rejected, allResults: stockResults };
}