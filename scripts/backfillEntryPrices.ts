import axios from 'axios';
import dotenv from 'dotenv';
import { tickerRangeAggsResponseSchema } from '../src/schemas.js';
import { polygonRequest } from '../src/rateLimit.js';
import { createSupabaseClient } from '../src/db/supabaseClient.js';

dotenv.config();

// One-off backfill for picks recorded before `entry_price` existed on the `picks` table.
// Fetches the close of the pick's run_date (the day the pipeline analyzed) from Polygon,
// matching what the pipeline itself now records at pick time going forward.
async function fetchDailyClose(ticker: string, date: string): Promise<number | null> {
  const endpoint = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${date}/${date}`;
  const response = await polygonRequest(() => axios.get(endpoint, {
    params: { adjusted: true, apiKey: process.env.MASSIVE_API_KEY },
  }));
  const parsed = tickerRangeAggsResponseSchema.safeParse(response.data);
  if (!parsed.success) return null;
  return parsed.data.results[0]?.c ?? null;
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');

  const supabase = createSupabaseClient();
  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, ticker, runs!inner(run_date)')
    .is('entry_price', null);
  if (error) throw new Error(`Failed to load picks: ${error.message}`);

  for (const pick of picks) {
    const run = Array.isArray(pick.runs) ? pick.runs[0] : pick.runs;
    if (!run) continue;
    try {
      const close = await fetchDailyClose(pick.ticker, run.run_date);
      if (close == null) {
        console.warn(`No daily close for ${pick.ticker} on ${run.run_date}, skipping`);
        continue;
      }
      const { error: updateError } = await supabase
        .from('picks')
        .update({ entry_price: close })
        .eq('id', pick.id);
      if (updateError) console.error(`Failed to backfill ${pick.ticker}:`, updateError.message);
      else console.log(`${pick.ticker} (${run.run_date}): entry_price = ${close}`);
    } catch (err) {
      console.error(`Failed to backfill ${pick.ticker}, skipping:`, err);
    }
  }
}

main().catch(error => {
  console.error('Failed to backfill entry prices:', error);
  process.exit(1);
});
