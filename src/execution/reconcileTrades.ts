import dotenv from 'dotenv';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { getPendingTrades, updateTradeStatus, TERMINAL_ORDER_STATUSES, type PendingTrade } from '../db/tradeStore.js';
import { getOrder } from './alpacaClient.js';

dotenv.config();

// A market day-order at open either fills within seconds or (rarely) sits unresolved — 30 min
// comfortably covers the former with margin, and there's no point waiting past a day order's
// own end-of-day expiry to call something "stuck". See docs/decisions/0014.
const POLL_BUDGET_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollOnce(pending: PendingTrade[], supabase: Awaited<ReturnType<typeof createSupabaseClient>>): Promise<PendingTrade[]> {
  const stillPending: PendingTrade[] = [];
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
  return stillPending;
}

async function main() {
  if (!process.env.ALPACA_API_KEY) throw new Error('ALPACA_API_KEY is not set');
  if (!process.env.ALPACA_API_SECRET) throw new Error('ALPACA_API_SECRET is not set');

  const supabase = createSupabaseClient();
  let pending = await getPendingTrades(supabase);
  if (pending.length === 0) {
    console.log('No pending trades to reconcile.');
    return;
  }

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (pending.length > 0 && Date.now() < deadline) {
    pending = await pollOnce(pending, supabase);
    if (pending.length > 0) await sleep(POLL_INTERVAL_MS);
  }

  if (pending.length > 0) {
    console.error(
      `${pending.length} trade(s) still unresolved after ${POLL_BUDGET_MS / 60_000} min:`,
      pending.map(t => `${t.ticker} (order ${t.alpacaOrderId})`).join(', ')
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Failed to reconcile trades:', error);
  process.exit(1);
});
