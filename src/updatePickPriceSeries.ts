import axios from 'axios';
import dotenv from 'dotenv';
import { tickerRangeAggsResponseSchema } from './schemas.js';
import { polygonRequest } from './rateLimit.js';
import { createSupabaseClient } from './db/supabaseClient.js';

dotenv.config();

const LOOKBACK_DAYS_BEFORE_PICK = 7;

interface PriceSeriesPoint {
  time: number; // unix seconds
  close: number;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchHourlySeries(ticker: string, pickDate: string): Promise<PriceSeriesPoint[]> {
  const fromDate = new Date(pickDate);
  fromDate.setDate(fromDate.getDate() - LOOKBACK_DAYS_BEFORE_PICK);

  const endpoint = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/hour/${formatDate(fromDate)}/${formatDate(new Date())}`;
  const response = await polygonRequest(() => axios.get(endpoint, {
    params: {
      adjusted: true,
      sort: 'asc',
      apiKey: process.env.MASSIVE_API_KEY,
    },
  }));

  const parsed = tickerRangeAggsResponseSchema.safeParse(response.data);
  if (!parsed.success) return [];
  return parsed.data.results.map(bar => ({
    time: Math.floor(bar.t / 1000),
    close: bar.c,
  }));
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');

  const supabase = createSupabaseClient();
  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, ticker, runs!inner(run_date, status)')
    .eq('runs.status', 'completed');
  if (error) throw new Error(`Failed to load picks: ${error.message}`);

  for (const pick of picks) {
    const run = Array.isArray(pick.runs) ? pick.runs[0] : pick.runs;
    if (!run) continue;
    try {
      console.log(`Fetching hourly price series for ${pick.ticker} (pick date ${run.run_date})...`);
      const series = await fetchHourlySeries(pick.ticker, run.run_date);
      if (series.length === 0) {
        console.warn(`No price data for ${pick.ticker}, skipping`);
        continue;
      }
      const { error: upsertError } = await supabase
        .from('pick_price_series')
        .upsert({ pick_id: pick.id, series, updated_at: new Date().toISOString() });
      if (upsertError) console.error(`Failed to store price series for ${pick.ticker}:`, upsertError.message);
    } catch (err) {
      console.error(`Failed to update price series for ${pick.ticker}, skipping this pick:`, err);
    }
  }
}

main().catch(error => {
  console.error('Failed to update pick price series:', error);
  process.exit(1);
});
