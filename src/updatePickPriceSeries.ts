import axios from 'axios';
import dotenv from 'dotenv';
import { alpacaBarsResponseSchema } from './schemas.js';
import { createSupabaseClient } from './db/supabaseClient.js';

dotenv.config();

const LOOKBACK_DAYS_BEFORE_PICK = 7;
// Alpaca's free plan only grants the IEX feed (~2-3% of consolidated volume), not full SIP —
// good enough for a chart, not for anything execution-sensitive. See docs/decisions/0013.
const ALPACA_DATA_FEED = 'iex';

interface PriceSeriesPoint {
  time: number; // unix seconds
  close: number;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetch15MinSeries(ticker: string, pickDate: string): Promise<PriceSeriesPoint[]> {
  const fromDate = new Date(pickDate);
  fromDate.setDate(fromDate.getDate() - LOOKBACK_DAYS_BEFORE_PICK);

  const endpoint = `https://data.alpaca.markets/v2/stocks/${ticker}/bars`;
  const response = await axios.get(endpoint, {
    params: {
      timeframe: '15Min',
      start: formatDate(fromDate),
      end: formatDate(new Date()),
      adjustment: 'raw',
      feed: ALPACA_DATA_FEED,
      limit: 10_000,
    },
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
    },
  });

  const parsed = alpacaBarsResponseSchema.safeParse(response.data);
  if (!parsed.success) return [];
  return (parsed.data.bars ?? []).map(bar => ({
    time: Math.floor(new Date(bar.t).getTime() / 1000),
    close: bar.c,
  }));
}

async function main() {
  if (!process.env.ALPACA_API_KEY) throw new Error('ALPACA_API_KEY is not set');
  if (!process.env.ALPACA_API_SECRET) throw new Error('ALPACA_API_SECRET is not set');

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
      console.log(`Fetching 15-min price series for ${pick.ticker} (pick date ${run.run_date})...`);
      const series = await fetch15MinSeries(pick.ticker, run.run_date);
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
