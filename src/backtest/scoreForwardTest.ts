import dotenv from 'dotenv';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { readForwardTestRuns } from './forwardTestRuns.js';
import { getForwardReturns } from './forwardReturn.js';

dotenv.config();

// Holding periods to score. 5-day is primary — see runBacktest.ts for the reasoning (the bull/bear
// catalyst's relevance fades fast, so "a week" tracks the judge's actual reasoning better than "a
// month"). 1-day is included because at this sample size it is the horizon the most recent runs
// have aged into; it is context, not the metric, and a strategy reasoning about a multi-day
// overreaction should not be judged on one session. 20 and 60 report n=0 until the runs age in.
const HORIZONS = [5, 1, 20, 60];
const PRIMARY_HORIZON = 5;

/**
 * Scores real production runs against a buy-every-researched-candidate baseline.
 *
 * This is the only rigorous validation of the deployed pipeline: real `web_search` research, real
 * judge, no proxy evidence source. The historical backtest (`runBacktest.ts`) is shelved because
 * its Tavily evidence was measured unfit — see docs/decisions/0016-shelve-tavily-backtest.md.
 *
 * The comparison that matters is the judge's picks against every candidate it saw. Beating the
 * baseline means the judge added something; matching it means the research and judging steps are
 * decoration on top of "buy whatever dropped most today."
 *
 * Reads from Supabase rather than the JSONL log, which cron runs never persisted — see
 * forwardTestRuns.ts.
 */
async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');

  const supabase = createSupabaseClient();
  const runs = await readForwardTestRuns(supabase);
  if (runs.length === 0) {
    console.log('No completed production runs in Supabase yet.');
    return;
  }

  const baselineReturns = new Map<number, number[]>(HORIZONS.map(h => [h, []]));
  const pickReturns = new Map<number, number[]>(HORIZONS.map(h => [h, []]));
  let scoredRuns = 0;
  let tooRecentRuns = 0;
  let noPickRuns = 0;

  // Per-run detail, printed as a table at the end. At n=9 picks the aggregate hides more than it
  // shows — whether a pick beat *its own day's field* is the comparison that survives a tiny
  // sample, since it controls for the market doing all the work on any given day.
  const perRun: { date: string; pick: string; pickReturn?: number | undefined; fieldAvg?: number | undefined; candidates: number }[] = [];

  for (const run of runs) {
    // Local noon, not UTC midnight. getForwardReturns formats dates with local getFullYear/
    // getMonth/getDate, so a UTC-midnight Date reads as the *previous* day anywhere west of
    // Greenwich — which silently took the baseline close from before the drop and folded the drop
    // itself into every return. Noon is far enough from either boundary to be timezone-proof.
    const date = new Date(`${run.runDate}T12:00:00`);
    let sawPrimary = false;
    const dayField: number[] = [];
    let dayPickReturn: number | undefined;

    for (const ticker of run.candidateTickers) {
      const forward = await getForwardReturns(ticker, date, HORIZONS);
      if (!forward) continue;
      for (const [horizon, fr] of forward) {
        baselineReturns.get(horizon)!.push(fr.pctReturn);
        if (run.pickTickers.includes(ticker)) pickReturns.get(horizon)!.push(fr.pctReturn);
        if (horizon === PRIMARY_HORIZON) {
          sawPrimary = true;
          dayField.push(fr.pctReturn);
          if (run.pickTickers.includes(ticker)) dayPickReturn = fr.pctReturn;
        }
      }
    }

    const avgOf = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined);
    perRun.push({
      date: run.runDate,
      pick: run.pickTickers.join(',') || 'none',
      pickReturn: dayPickReturn,
      fieldAvg: avgOf(dayField),
      candidates: run.candidateTickers.length,
    });

    if (!sawPrimary) {
      tooRecentRuns++;
      continue;
    }
    if (run.pickTickers.length === 0) noPickRuns++;
    scoredRuns++;
  }

  const avg = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined);
  const winRate = (nums: number[]) => (nums.length > 0 ? nums.filter(n => n > 0).length / nums.length : undefined);
  const fmt = (nums: number[]) => {
    const a = avg(nums);
    if (a === undefined) return 'n/a (n=0)';
    return `${a.toFixed(2)}% (win rate ${((winRate(nums) ?? 0) * 100).toFixed(0)}%, n=${nums.length})`;
  };

  console.log('\n=== Forward Test (real pipeline, live web_search) ===');
  console.log(`Runs: ${runs.length} total, ${scoredRuns} scored at ${PRIMARY_HORIZON}d, ${tooRecentRuns} too recent, ${noPickRuns} scored with no pick.`);

  const pct = (n: number | undefined) => (n === undefined ? '    —' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
  console.log(`\nPer run (${PRIMARY_HORIZON}-day):`);
  console.log('  date        pick     pick ret   field avg   beat field?');
  for (const row of perRun) {
    const beat = row.pickReturn !== undefined && row.fieldAvg !== undefined
      ? (row.pickReturn > row.fieldAvg ? 'yes' : 'no')
      : (row.pick === 'none' ? 'n/a (no pick)' : 'pending');
    console.log(`  ${row.date}  ${row.pick.padEnd(7)} ${pct(row.pickReturn).padStart(8)}   ${pct(row.fieldAvg).padStart(8)}   ${beat}`);
  }

  for (const horizon of HORIZONS) {
    const baseline = baselineReturns.get(horizon) ?? [];
    const picks = pickReturns.get(horizon) ?? [];
    console.log(`\n[${horizon}-day${horizon === PRIMARY_HORIZON ? ' (primary)' : ''}]`);
    console.log(`  Baseline (every researched candidate): ${fmt(baseline)}`);
    console.log(`  Judge picks                          : ${fmt(picks)}`);
    const bAvg = avg(baseline);
    const pAvg = avg(picks);
    if (bAvg !== undefined && pAvg !== undefined) {
      console.log(`  Edge                                 : ${(pAvg - bAvg >= 0 ? '+' : '')}${(pAvg - bAvg).toFixed(2)} pts`);
    }
  }

  // Stated rather than left for the reader to work out: at this sample size the numbers above are
  // descriptive, not evidence. One pick per weekday means a horizon needs months before its n is
  // large enough for the edge to mean anything.
  const primaryPicks = pickReturns.get(PRIMARY_HORIZON)?.length ?? 0;
  if (primaryPicks < 30) {
    console.log(`\nn=${primaryPicks} picks at the primary horizon. Too few to distinguish edge from noise — treat as a smoke test, not a result.`);
  }
}

main().catch(console.error);
