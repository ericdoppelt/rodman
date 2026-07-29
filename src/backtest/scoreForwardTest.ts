import dotenv from 'dotenv';
import { readForwardTestLog } from './logRun.js';
import { getForwardReturns } from './forwardReturn.js';

dotenv.config();

// Holding periods to score. Primary metric is HORIZONS[0] — see runBacktest.ts for the reasoning
// (the bull/bear catalyst's relevance fades fast, so "a week" tracks the judge's actual
// reasoning better than "a month"). Keep in sync with runBacktest.ts.
const HORIZONS = [5, 20];

/**
 * Scores real production runs logged by `logRun.ts`. Unlike `runBacktest.ts`, this reflects
 * the actual deployed pipeline — real `web_search` research, no proxy tools — so it's the
 * rigorous validation of pick quality. It just needs time: entries logged fewer than
 * max(HORIZONS) trading days ago don't have a forward return yet for the longer horizons.
 */
async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');

  const entries = readForwardTestLog();
  if (entries.length === 0) {
    console.log('No forward-test log entries yet — run the real pipeline (pnpm start) for a while first.');
    return;
  }

  const allCandidateReturns = new Map<number, number[]>(HORIZONS.map(h => [h, []]));
  const pickReturns = new Map<number, number[]>(HORIZONS.map(h => [h, []]));
  let scoredDays = 0;
  let tooRecentDays = 0;

  for (const entry of entries) {
    const date = new Date(entry.date);
    let sawAnyData = false;

    for (const dip of entry.dips) {
      const forward = await getForwardReturns(dip.ticker, date, HORIZONS);
      if (forward) {
        sawAnyData = true;
        for (const [horizon, fr] of forward) {
          allCandidateReturns.get(horizon)!.push(fr.pctReturn);
          if (entry.picks[0]?.ticker === dip.ticker) {
            pickReturns.get(horizon)!.push(fr.pctReturn);
          }
        }
      }
    }

    if (!sawAnyData) {
      tooRecentDays++;
      console.log(`${entry.date}: not enough time has passed yet for a forward return — skipping.`);
      continue;
    }
    scoredDays++;
    console.log(`${entry.date}: pick=${entry.picks[0]?.ticker ?? 'none'}`);
  }

  const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
  const winRate = (nums: number[]) => nums.length > 0 ? nums.filter(n => n > 0).length / nums.length : undefined;

  console.log('\n=== Forward-Test Summary (real pipeline, real web_search research) ===');
  console.log(`Logged days: ${entries.length} (scored at least one horizon: ${scoredDays}, too recent for any: ${tooRecentDays})`);

  for (const horizon of HORIZONS) {
    const candidateReturns = allCandidateReturns.get(horizon) ?? [];
    const picks = pickReturns.get(horizon) ?? [];
    const label = horizon === HORIZONS[0] ? `${horizon}-day (primary)` : `${horizon}-day`;
    console.log(`\n[${label}]`);
    console.log(`  Baseline (every qualifying dip) avg return: ${avg(candidateReturns)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(candidateReturns) ?? 0) * 100).toFixed(0)}%, n=${candidateReturns.length})`);
    console.log(`  Judge picks avg return: ${avg(picks)?.toFixed(2) ?? 'n/a'}% (win rate ${((winRate(picks) ?? 0) * 100).toFixed(0)}%, n=${picks.length})`);
  }
}

main().catch(console.error);
