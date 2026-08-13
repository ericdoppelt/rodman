import type { SupabaseClient } from '@supabase/supabase-js';

export interface ForwardTestRun {
  runId: string;
  runDate: string;
  candidateTickers: string[];
  pickTickers: string[];
}

/**
 * Reads completed production runs out of Supabase for forward-test scoring.
 *
 * This replaces `logRun.ts`'s JSONL file as the source of truth. That file is written to `data/`,
 * which is gitignored, and `pnpm start` runs on a GitHub Actions cron against an ephemeral
 * checkout — so every cron run appended to a file that was discarded moments later, and only runs
 * launched from a developer's own machine ever persisted. Supabase is written by the same runs and
 * survives, so scoring reads from there instead. See BACKLOG.md track 2.
 *
 * Candidates come from `llm_calls` rather than a dedicated table: every researched ticker has bull
 * and bear rows, so the distinct tickers per run are exactly the candidate set the judge chose
 * from. Tickers rejected before research (`rejected_candidates`) are deliberately excluded — they
 * never reached the judge, so including them would measure the market-cap screen, not the judge.
 *
 * Failed runs are skipped: a run that errored partway has an arbitrary subset of its candidates
 * researched, which would bias the baseline toward whichever tickers happened to finish first.
 */
export async function readForwardTestRuns(supabase: SupabaseClient): Promise<ForwardTestRun[]> {
  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select('id, run_date')
    .eq('status', 'completed')
    .order('run_date', { ascending: true });
  if (runsError) throw new Error(`Failed to read runs: ${runsError.message}`);
  if (!runs || runs.length === 0) return [];

  const runIds = runs.map(run => run.id);

  const { data: calls, error: callsError } = await supabase
    .from('llm_calls')
    .select('run_id, ticker')
    .in('run_id', runIds)
    .in('call_type', ['bull', 'bear']);
  if (callsError) throw new Error(`Failed to read llm_calls: ${callsError.message}`);

  const { data: picks, error: picksError } = await supabase
    .from('picks')
    .select('run_id, ticker')
    .in('run_id', runIds);
  if (picksError) throw new Error(`Failed to read picks: ${picksError.message}`);

  const candidatesByRun = new Map<string, Set<string>>();
  for (const call of calls ?? []) {
    if (!call.ticker) continue;
    let set = candidatesByRun.get(call.run_id);
    if (!set) { set = new Set(); candidatesByRun.set(call.run_id, set); }
    set.add(call.ticker);
  }

  const picksByRun = new Map<string, string[]>();
  for (const pick of picks ?? []) {
    const list = picksByRun.get(pick.run_id) ?? [];
    list.push(pick.ticker);
    picksByRun.set(pick.run_id, list);
  }

  return runs.map(run => ({
    runId: run.id,
    runDate: run.run_date,
    candidateTickers: [...(candidatesByRun.get(run.id) ?? [])],
    pickTickers: picksByRun.get(run.id) ?? [],
  }));
}
