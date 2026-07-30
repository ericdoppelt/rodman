import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockPick } from '../schemas.js';

export interface RunParams {
  dipsLimit: number;
  minDollarVolume: number;
  minMarketCap: number;
}

export async function createRun(supabase: SupabaseClient, runDate: string, params: RunParams, gitSha: string | undefined): Promise<string> {
  const { data, error } = await supabase
    .from('runs')
    .insert({ run_date: runDate, params, git_sha: gitSha ?? null, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data.id;
}

export async function finalizeRun(supabase: SupabaseClient, runId: string, totalCostUsd: number): Promise<void> {
  const { error } = await supabase
    .from('runs')
    .update({ status: 'completed', total_cost_usd: totalCostUsd, completed_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) console.error(`Failed to finalize run ${runId}:`, error.message);
}

export async function failRun(supabase: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('runs')
    .update({ status: 'failed', error: errorMessage, completed_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) console.error(`Failed to mark run ${runId} as failed:`, error.message);
}

export async function recordPicks(supabase: SupabaseClient, runId: string, picks: StockPick, entryPrices: Record<string, number>): Promise<void> {
  if (picks.length === 0) return;
  const { error } = await supabase
    .from('picks')
    .insert(picks.map(pick => ({ run_id: runId, ticker: pick.ticker, reasoning: pick.reasoning, entry_price: entryPrices[pick.ticker] ?? null })));
  if (error) console.error(`Failed to record picks for run ${runId}:`, error.message);
}

export async function recordRejectedCandidate(
  supabase: SupabaseClient,
  runId: string,
  ticker: string,
  reason: string,
  details?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('rejected_candidates')
    .insert({ run_id: runId, ticker, reason, details: details ?? null });
  if (error) console.error(`Failed to record rejected candidate ${ticker}:`, error.message);
}
