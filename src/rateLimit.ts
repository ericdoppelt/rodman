import axios from 'axios';

// Polygon free tier allows 5 calls/min; space out calls to stay under that.
export const POLYGON_CALL_DELAY_MS = 12_000;
const MAX_429_RETRIES = 4;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Tracks the last Polygon call across the whole process (not just within one loop), so calls
// made from different functions or different iterations of the backtest's day loop — e.g. a
// skipped day immediately followed by the next day's dip scan — still stay spaced out.
let _lastPolygonCallAt = 0;

async function _waitForSlot(): Promise<void> {
  const elapsed = Date.now() - _lastPolygonCallAt;
  if (elapsed < POLYGON_CALL_DELAY_MS) {
    await sleep(POLYGON_CALL_DELAY_MS - elapsed);
  }
  _lastPolygonCallAt = Date.now();
}

/**
 * Runs a Polygon API call with the shared rate-limit throttle, retrying with escalating backoff
 * on 429s. The 12s spacing matches the free tier's stated 5-calls/min limit exactly, which
 * leaves no margin for network jitter or timing drift over a long run — a single occasional 429
 * shouldn't crash a multi-hour backtest and throw away everything already computed.
 */
export async function polygonRequest<T>(makeRequest: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await _waitForSlot();
    try {
      return await makeRequest();
    } catch (error) {
      const is429 = axios.isAxiosError(error) && error.response?.status === 429;
      if (!is429 || attempt >= MAX_429_RETRIES) throw error;
      const backoffMs = POLYGON_CALL_DELAY_MS * (attempt + 2);
      console.warn(`Polygon rate limit hit — retrying in ${backoffMs / 1000}s (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
      await sleep(backoffMs);
    }
  }
}
