import type { PriceSeriesPoint } from '../types';

export type Trend = 'up' | 'down' | 'flat';

export function trendOf(entryClose: number, latestClose: number): Trend {
  if (latestClose > entryClose) return 'up';
  if (latestClose < entryClose) return 'down';
  return 'flat';
}

function dateStringOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// The pipeline runs on end-of-day data, so a pick is anchored to the *close* of pickDate,
// not its open — the dip that triggers a pick can happen intraday (e.g. an afternoon
// reversal), so marking the day's first bar would place "Picked" before the drop even happened.
export function findEntryIndex(series: PriceSeriesPoint[], pickDate: string): number {
  let lastOnPickDate = -1;
  for (let i = 0; i < series.length; i++) {
    const barDate = dateStringOf(series[i].time);
    if (barDate === pickDate) lastOnPickDate = i;
    else if (barDate > pickDate) break;
  }
  if (lastOnPickDate !== -1) return lastOnPickDate;
  const fallback = series.findIndex(point => dateStringOf(point.time) >= pickDate);
  return fallback === -1 ? 0 : fallback;
}

export interface PickReturn {
  entryClose: number;
  latestClose: number;
  pctReturn: number;
  trend: Trend;
}

// Returns null when there isn't enough series data yet to compute a return
// (chart pending — pick made too recently for the next trading day's data to land).
export function computePickReturn(series: PriceSeriesPoint[], pickDate: string): PickReturn | null {
  if (series.length < 2) return null;
  const entryIndex = findEntryIndex(series, pickDate);
  const entryClose = series[entryIndex].close;
  const latestClose = series[series.length - 1].close;
  return {
    entryClose,
    latestClose,
    pctReturn: ((latestClose - entryClose) / entryClose) * 100,
    trend: trendOf(entryClose, latestClose),
  };
}
