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
  picks: Pick[];
  llm_calls: LlmCall[];
  rejected_candidates: RejectedCandidate[];
}
