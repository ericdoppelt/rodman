import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Persists which ticker (if any) the judge picked for a given date, as soon as it's decided — so
// a crashed/interrupted `pnpm backtest` run can be resumed by rerunning the same command instead
// of re-paying Claude cost for days already judged. Keyed by runKey (bull/bear + judge model), NOT
// shared with dailyCache.ts's raw-data cache — a scored pick is only valid for the exact model
// config that produced it, so a model-config change starts a fresh progress directory.
//
// Deliberately does NOT store forward returns alongside the pick: those live in dailyCache.ts,
// keyed by date/ticker/horizon, and get recomputed fresh from there at aggregation time (see
// runBacktest.ts's _computeDayResult). The judge's pick doesn't depend on which horizons we're
// scoring against, so adding a new horizon later only needs a dailyCache backfill (warmCache.ts)
// — never a Claude rerun — as long as every scored date here still has a dailyCache entry.
const PROGRESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../data/backtest-progress');

// A day's judge output — the single-pick judge writes 0-1 entries, the elimination judge (see
// eliminationJudge.ts) can write 0-N. Both strategies share this shape (ticker + reasoning) so
// aggregation code doesn't need to branch on which judge produced it.
export interface ScoredDay {
  picks: { ticker: string; reasoning: string }[];
}

function _runDir(runKey: string): string {
  return join(PROGRESS_ROOT, runKey.replace(/[^a-zA-Z0-9_.-]/g, '_'));
}

export function readScoredDay(runKey: string, dateKey: string): ScoredDay | undefined {
  const path = join(_runDir(runKey), `${dateKey}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeScoredDay(runKey: string, dateKey: string, entry: ScoredDay): void {
  const dir = _runDir(runKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${dateKey}.json`), JSON.stringify(entry, null, 2));
}
