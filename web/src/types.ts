export interface PriceSeriesPoint {
  time: number; // unix seconds
  close: number;
}

export interface Pick {
  id: string;
  run_id: string;
  ticker: string;
  reasoning: string;
  entry_price: number | null;
  created_at: string;
  pick_price_series: { series: PriceSeriesPoint[] } | null;
}

export interface Run {
  id: string;
  run_date: string;
  status: 'running' | 'completed' | 'failed';
  total_cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
  picks: Pick[];
}

export type LlmCallType = 'market_context' | 'bull' | 'bear' | 'judge';

export interface LlmCall {
  id: string;
  run_id: string;
  call_type: LlmCallType;
  ticker: string | null;
  model: string;
  raw_response: unknown;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
}

export interface RejectedCandidate {
  id: string;
  run_id: string;
  ticker: string;
  reason: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface RunFlow {
  id: string;
  run_date: string;
  total_cost_usd: number | null;
  /** Judge's stated reason for making no pick. */
  no_pick_reason: string | null;
  /** Non-null means the reason was reconstructed later, not recorded during the run. */
  no_pick_reason_backfilled_at: string | null;
  /** Non-null means the run was completed by replaying stored research after it failed. */
  reconstructed_at: string | null;
  picks: Pick[];
  llm_calls: LlmCall[];
  rejected_candidates: RejectedCandidate[];
}
