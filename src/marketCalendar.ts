// NYSE full-day closures. Half sessions (the day after Thanksgiving, Christmas Eve) are real
// trading days and deliberately absent. Extend this when the window moves past 2026.
const MARKET_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * True for dates the US market was closed — weekends and full-day holidays.
 *
 * Polygon's grouped-daily endpoint cannot be trusted to return an empty result for these. Of 151
 * cached weekend dates, 18 came back with bars; Thanksgiving and Christmas 2025 each came back
 * with ~11.6k rows. That data isn't a copy of an adjacent session either (the hashes differ), so
 * there is no way to detect it from the payload — hence an explicit calendar. Labor Day 2025 did
 * come back empty, so the behavior isn't even consistent day to day.
 *
 * Reads the day-of-week in UTC from the date key itself, which is how cache entries are keyed —
 * deriving it from a local-midnight Date would disagree across timezones.
 */
export function isNonTradingDay(dateKey: string): boolean {
  if (MARKET_HOLIDAYS.has(dateKey)) return true;
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The most recent trading day strictly before `date`. Walks back a bounded number of calendar days
 * so a long closure can't spin forever; the cap comfortably clears the longest US market closure.
 */
export function previousTradingDay(date: Date, maxLookbackDays = 10): Date | undefined {
  const cursor = new Date(date);
  for (let i = 0; i < maxLookbackDays; i++) {
    cursor.setDate(cursor.getDate() - 1);
    if (!isNonTradingDay(toDateKey(cursor))) return new Date(cursor);
  }
  return undefined;
}
