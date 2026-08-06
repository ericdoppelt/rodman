import type { SupabaseClient } from '@supabase/supabase-js';
import { placeNotionalBuyOrder } from './alpacaClient.js';
import { recordTrade } from '../db/tradeStore.js';

// Fixed-size placeholder, not a risk-management system — see
// docs/decisions/0012-alpaca-paper-trading-execution.md.
const NOTIONAL_USD_PER_PICK = 20;

export async function executeTrades(supabase: SupabaseClient, picks: { id: string; ticker: string }[]): Promise<void> {
  for (const pick of picks) {
    try {
      const result = await placeNotionalBuyOrder(pick.ticker, NOTIONAL_USD_PER_PICK);
      console.log(`Alpaca order placed for ${pick.ticker}: ${result.orderId} (${result.status})`);
      await recordTrade(supabase, {
        pickId: pick.id,
        ticker: pick.ticker,
        notionalUsd: NOTIONAL_USD_PER_PICK,
        orderId: result.orderId,
        status: result.status,
        filledQty: result.filledQty,
        filledAvgPrice: result.filledAvgPrice,
        error: null,
        raw: result.raw,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to place Alpaca order for ${pick.ticker}:`, message);
      await recordTrade(supabase, {
        pickId: pick.id,
        ticker: pick.ticker,
        notionalUsd: NOTIONAL_USD_PER_PICK,
        orderId: null,
        status: 'failed',
        filledQty: null,
        filledAvgPrice: null,
        error: message,
        raw: null,
      });
    }
  }
}
