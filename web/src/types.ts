export interface PriceSeriesPoint {
  time: number; // unix seconds
  close: number;
}

export interface Pick {
  id: string;
  run_id: string;
  ticker: string;
  reasoning: string;
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
