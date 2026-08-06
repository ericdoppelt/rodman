import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_INSERT_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface TradeRecord {
  pickId: string;
  ticker: string;
  notionalUsd: number;
  orderId: string | null;
  status: string;
  filledQty: number | null;
  filledAvgPrice: number | null;
  error: string | null;
  raw: unknown;
}

// Alpaca order statuses that won't change anymore — see
// https://docs.alpaca.markets/docs/orders-at-alpaca#order-lifecycle. Anything else (new,
// accepted, pending_new, partially_filled, etc.) still needs to be watched.
export const TERMINAL_ORDER_STATUSES = new Set([
  'filled', 'canceled', 'expired', 'replaced', 'rejected', 'stopped', 'suspended',
  'calculated', 'done_for_day',
]);

export interface PendingTrade {
  id: string;
  ticker: string;
  alpacaOrderId: string;
}

export async function getPendingTrades(supabase: SupabaseClient): Promise<PendingTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('id, symbol, alpaca_order_id')
    .not('alpaca_order_id', 'is', null)
    .not('status', 'in', `(${[...TERMINAL_ORDER_STATUSES].join(',')})`);
  if (error) throw new Error(`Failed to load pending trades: ${error.message}`);
  return data.map(row => ({ id: row.id, ticker: row.symbol, alpacaOrderId: row.alpaca_order_id }));
}

export async function updateTradeStatus(
  supabase: SupabaseClient,
  tradeId: string,
  update: { status: string; filledQty: number | null; filledAvgPrice: number | null; raw: unknown }
): Promise<void> {
  const row = {
    status: update.status,
    filled_qty: update.filledQty,
    filled_avg_price: update.filledAvgPrice,
    raw: update.raw ?? null,
  };

  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.from('trades').update(row).eq('id', tradeId);
    if (!error) return;
    if (attempt >= MAX_INSERT_RETRIES) {
      console.error(`Failed to update trade ${tradeId} after ${attempt + 1} attempts:`, error.message);
      return;
    }
    console.warn(`Failed to update trade ${tradeId} (attempt ${attempt + 1}/${MAX_INSERT_RETRIES + 1}), retrying:`, error.message);
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
}

export async function recordTrade(supabase: SupabaseClient, record: TradeRecord): Promise<void> {
  const row = {
    pick_id: record.pickId,
    symbol: record.ticker,
    notional_usd: record.notionalUsd,
    alpaca_order_id: record.orderId,
    status: record.status,
    filled_qty: record.filledQty,
    filled_avg_price: record.filledAvgPrice,
    error: record.error,
    raw: record.raw ?? null,
  };

  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.from('trades').insert(row);
    if (!error) return;
    if (attempt >= MAX_INSERT_RETRIES) {
      console.error(`Failed to record trade for ${record.ticker} after ${attempt + 1} attempts:`, error.message);
      return;
    }
    console.warn(`Failed to record trade for ${record.ticker} (attempt ${attempt + 1}/${MAX_INSERT_RETRIES + 1}), retrying:`, error.message);
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
}
