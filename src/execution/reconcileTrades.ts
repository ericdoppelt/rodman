import dotenv from 'dotenv';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { getPendingTrades, updateTradeStatus, TERMINAL_ORDER_STATUSES } from '../db/tradeStore.js';
import { getOrder } from './alpacaClient.js';

dotenv.config();

// A market day-order at open either fills within seconds or (rarely) sits unresolved — 30 min
// past market open comfortably covers the former with margin. This runs as one pass per
// invocation (called every 15 min by the shared update-price-series.yml cron, see
// docs/decisions/0014), not an internal poll loop, so "stuck" is judged against wall-clock time
// relative to today's open rather than time-since-this-process-started.
const GRACE_PERIOD_AFTER_OPEN_MS = 30 * 60_000;

// UTC offset (minutes) of America/New_York at UTC noon today — noon avoids any DST-transition
// edge case, since the offset is constant across a single calendar day.
function nyOffsetMinutes(): number {
  const utcNoon = new Date();
  utcNoon.setUTCHours(12, 0, 0, 0);
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

// Unix ms for 9:30 AM ET (NYSE regular-session open) today.
function marketOpenMs(): number {
  const now = new Date();
  const offsetMin = nyOffsetMinutes();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 30, 0) - offsetMin * 60_000;
}

async function main() {
  if (!process.env.ALPACA_API_KEY) throw new Error('ALPACA_API_KEY is not set');
  if (!process.env.ALPACA_API_SECRET) throw new Error('ALPACA_API_SECRET is not set');

  const supabase = createSupabaseClient();
  const pending = await getPendingTrades(supabase);
  if (pending.length === 0) {
    console.log('No pending trades to reconcile.');
    return;
  }

  const pastGracePeriod = Date.now() > marketOpenMs() + GRACE_PERIOD_AFTER_OPEN_MS;
  const stillPending: typeof pending = [];

  for (const trade of pending) {
    const order = await getOrder(trade.alpacaOrderId);
    if (!TERMINAL_ORDER_STATUSES.has(order.status)) {
      stillPending.push(trade);
      continue;
    }
    await updateTradeStatus(supabase, trade.id, {
      status: order.status,
      filledQty: order.filledQty,
      filledAvgPrice: order.filledAvgPrice,
      raw: order.raw,
    });
    if (order.status === 'filled') {
      console.log(`${trade.ticker} order ${trade.alpacaOrderId} filled at ${order.filledAvgPrice}`);
    } else {
      console.warn(`${trade.ticker} order ${trade.alpacaOrderId} ended as '${order.status}' — never bought`);
    }
  }

  if (stillPending.length > 0 && pastGracePeriod) {
    console.error(
      `${stillPending.length} trade(s) still unresolved more than 30 min after market open:`,
      stillPending.map(t => `${t.ticker} (order ${t.alpacaOrderId})`).join(', ')
    );
    process.exitCode = 1;
  } else if (stillPending.length > 0) {
    console.log(`${stillPending.length} trade(s) still pending, within the normal post-open grace period.`);
  }
}

main().catch(error => {
  console.error('Failed to reconcile trades:', error);
  process.exit(1);
});
