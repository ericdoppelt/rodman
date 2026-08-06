import type { PriceSeriesPoint } from '../types';

export type Trend = 'up' | 'down' | 'flat';

export function trendOf(entryClose: number, latestClose: number): Trend {
  if (latestClose > entryClose) return 'up';
  if (latestClose < entryClose) return 'down';
  return 'flat';
}

// UTC offset (minutes) of America/New_York at UTC noon on `dateStr` — noon avoids any
// DST-transition edge case, since the offset is constant across a single calendar day.
function nyOffsetMinutes(dateStr: string): number {
  const utcNoon = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcNoon);
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  return hour * 60 + minute - 12 * 60;
}

// Unix seconds for 4:00 PM ET (NYSE regular-session close) on `pickDate` — the exact moment
// entry_price (the pipeline's dip-day close) represents.
export function marketCloseUnixSeconds(pickDate: string): number {
  const [year, month, day] = pickDate.split('-').map(Number);
  const offsetMin = nyOffsetMinutes(pickDate);
  return (Date.UTC(year, month - 1, day, 16, 0, 0) - offsetMin * 60_000) / 1000;
}

// Inserts entry_price as an actual plotted point at the regular-session close, so the "Picked"
// marker always sits exactly on the line instead of near whichever 15-min bar happens to be
// closest — those come from a different Alpaca endpoint and can differ slightly in price.
export function withEntryPoint(series: PriceSeriesPoint[], pickDate: string, entryPrice: number): PriceSeriesPoint[] {
  const time = marketCloseUnixSeconds(pickDate);
  const withoutDuplicate = series.filter(point => point.time !== time);
  return [...withoutDuplicate, { time, close: entryPrice }].sort((a, b) => a.time - b.time);
}

export interface PickReturn {
  entryClose: number;
  latestClose: number;
  pctReturn: number;
  trend: Trend;
}

// Returns null when there isn't enough series data yet to compute a return
// (chart pending — pick made too recently for the next trading day's data to land).
export function computePickReturn(series: PriceSeriesPoint[], entryPrice: number | null): PickReturn | null {
  if (series.length === 0 || entryPrice == null) return null;
  const latestClose = series[series.length - 1].close;
  return {
    entryClose: entryPrice,
    latestClose,
    pctReturn: ((latestClose - entryPrice) / entryPrice) * 100,
    trend: trendOf(entryPrice, latestClose),
  };
}
