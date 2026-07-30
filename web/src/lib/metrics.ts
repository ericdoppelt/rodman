import type { Run } from '../types';
import { computePickReturn } from './trend';

export interface BestPick {
  ticker: string;
  runDate: string;
  pctReturn: number;
}

export interface AggregateMetrics {
  totalPicks: number;
  scoredPicks: number; // picks with enough series data to have a return
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null; // wins / (wins + losses), null if no decided picks yet
  avgReturnPct: number | null;
  best: BestPick | null;
  worst: BestPick | null;
}

export function computeMetrics(runs: Run[]): AggregateMetrics {
  let totalPicks = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let returnSum = 0;
  let best: BestPick | null = null;
  let worst: BestPick | null = null;

  for (const run of runs) {
    for (const pick of run.picks) {
      totalPicks++;
      const result = computePickReturn(pick.pick_price_series?.series ?? [], pick.entry_price);
      if (!result) continue;

      if (result.trend === 'up') wins++;
      else if (result.trend === 'down') losses++;
      else flats++;

      returnSum += result.pctReturn;

      if (!best || result.pctReturn > best.pctReturn) {
        best = { ticker: pick.ticker, runDate: run.run_date, pctReturn: result.pctReturn };
      }
      if (!worst || result.pctReturn < worst.pctReturn) {
        worst = { ticker: pick.ticker, runDate: run.run_date, pctReturn: result.pctReturn };
      }
    }
  }

  const scoredPicks = wins + losses + flats;
  const decided = wins + losses;

  return {
    totalPicks,
    scoredPicks,
    wins,
    losses,
    flats,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    avgReturnPct: scoredPicks > 0 ? returnSum / scoredPicks : null,
    best,
    worst,
  };
}
