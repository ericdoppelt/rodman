import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { StockChange, StockResearch, StockPick } from '../schemas.js';

export const LOG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/forward-test-log.jsonl');

export interface ForwardTestLogEntry {
  date: string;
  loggedAt: string;
  marketContext: string;
  dips: StockChange[];
  research: StockResearch[];
  picks: StockPick;
}

/**
 * Appends one real production run (real `web_search`, real research quality) to the
 * forward-test log. This is the only rigorous validation of the actual deployed pipeline —
 * see BACKLOG.md. Once entries are old enough for a forward return to exist, score them with
 * scoreForwardTest.ts. The logged research also doubles as non-leaked fixture data for
 * judge-prompt-calibration backtests, since it was genuinely produced point-in-time.
 */
export function logRun(entry: Omit<ForwardTestLogEntry, 'loggedAt'>): void {
  const fullEntry: ForwardTestLogEntry = { ...entry, loggedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(fullEntry) + '\n');
}

export function readForwardTestLog(): ForwardTestLogEntry[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as ForwardTestLogEntry);
}
