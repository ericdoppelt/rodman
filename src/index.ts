import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from './fetchTopDips.js';
import { getMarketContext } from './fetchMarketContext.js';
import { researchStockChanges } from './stockAgents.js';
import { pickStock } from './judgeResearch.js';
import { getTotalCost } from './usageTracker.js';
import { logRun } from './backtest/logRun.js';
import { createSupabaseClient } from './db/supabaseClient.js';
import { createRun, finalizeRun, failRun, recordPicks, recordRejectedCandidate } from './db/runStore.js';
import { getGitSha } from './gitSha.js';
import { executeTrades } from './execution/executeTrades.js';

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Stock-selection parameters — logged per run (runs.params) for traceability across changes.
const DIPS_LIMIT = 10;
const MIN_DOLLAR_VOLUME = 10_000_000;
const MIN_MARKET_CAP = 100_000_000;

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  // Alpaca creds are checked later, right before use — a missing/misconfigured trade-execution
  // credential should never block pick generation, the pipeline's actual core output.

  const supabase = createSupabaseClient();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const runDate = yesterday.toISOString().slice(0, 10);

  const runId = await createRun(
    supabase,
    runDate,
    { dipsLimit: DIPS_LIMIT, minDollarVolume: MIN_DOLLAR_VOLUME, minMarketCap: MIN_MARKET_CAP },
    getGitSha()
  );
  const record = { supabase, runId };

  try {
    console.log('Fetching top dips...');
    const { qualifying: dips, rejected: rejectedDips, allResults } = await getLargestStockDips(yesterday, DIPS_LIMIT, MIN_DOLLAR_VOLUME, MIN_MARKET_CAP);
    if (allResults.length === 0) {
      console.log('No stock data for', runDate, '(market holiday or no data) — skipping run.');
      await finalizeRun(supabase, runId, 0);
      return;
    }
    dips.forEach(stock => {
      console.log(`${stock.ticker}: ${stock.percentageChange.toFixed(2)}% | volume: ${stock.volume.toLocaleString()}`);
    });
    for (const candidate of rejectedDips) {
      await recordRejectedCandidate(supabase, runId, candidate.ticker, candidate.reason, candidate.details);
    }

    console.log('Fetching market context...');
    const marketContext = await getMarketContext(client, yesterday, record);
    console.log('Market Context:');
    console.log(marketContext);
    console.log('---');

    console.log('Analyzing stocks...');
    const { research, rejected: rejectedResearch } = await researchStockChanges(client, dips, marketContext, yesterday, record);
    research.forEach(res => console.log(`${res.stockChange.ticker} research`, res));
    rejectedResearch.forEach(r => console.log(`${r.ticker} research failed:`, r.details));

    console.log('Judging research...');
    const picks = await pickStock(client, research, yesterday, record);
    if (picks.length === 0) {
      console.log('No stock met the bar for a recommendation today.');
    } else {
      picks.forEach(pick => console.log(`PICK: ${pick.ticker} — ${pick.reasoning}`));
    }
    const entryPrices = Object.fromEntries(research.map(r => [r.stockChange.ticker, r.stockChange.close]));
    const recordedPicks = await recordPicks(supabase, runId, picks, entryPrices);

    if (recordedPicks.length > 0) {
      if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
        console.warn('ALPACA_API_KEY/ALPACA_API_SECRET not set — skipping paper trade execution for this run.');
      } else {
        console.log('Placing paper trades on Alpaca...');
        // Picks are already durably recorded above — an unexpected failure here must never
        // propagate to the outer catch, which would mark this otherwise-successful run 'failed'
        // and hide its (already-recorded, real) picks from the RLS-scoped public UI.
        try {
          await executeTrades(supabase, recordedPicks);
        } catch (error) {
          console.error('Trade execution failed unexpectedly (picks are still recorded):', error);
        }
      }
    }

    const totalCost = getTotalCost();
    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    await finalizeRun(supabase, runId, totalCost);

    logRun({
      date: runDate,
      marketContext,
      dips,
      research,
      picks,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failRun(supabase, runId, errorMessage);
    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});