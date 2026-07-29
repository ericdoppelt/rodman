// Polygon free tier allows 5 calls/min; space out calls to stay under that.
export const POLYGON_CALL_DELAY_MS = 12_000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Tracks the last Polygon call across the whole process (not just within one loop), so calls
// made from different functions or different iterations of the backtest's day loop — e.g. a
// skipped day immediately followed by the next day's dip scan — still stay spaced out.
let _lastPolygonCallAt = 0;

/** Blocks until POLYGON_CALL_DELAY_MS has elapsed since the last Polygon call anywhere in the process. */
export async function throttlePolygonCall(): Promise<void> {
  const elapsed = Date.now() - _lastPolygonCallAt;
  if (elapsed < POLYGON_CALL_DELAY_MS) {
    await sleep(POLYGON_CALL_DELAY_MS - elapsed);
  }
  _lastPolygonCallAt = Date.now();
}
