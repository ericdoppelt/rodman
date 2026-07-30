import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';

export interface RunRecordContext {
  supabase: SupabaseClient;
  runId: string;
}

export type LlmCallType = 'market_context' | 'bull' | 'bear' | 'judge';

export interface LlmCallRecord {
  runId: string;
  callType: LlmCallType;
  ticker?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: unknown;
  usage: Anthropic.Usage;
  costUsd: number;
  latencyMs: number;
}

const MAX_INSERT_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function recordLlmCall(supabase: SupabaseClient, record: LlmCallRecord): Promise<void> {
  const label = `${record.callType} LLM call${record.ticker ? ` (${record.ticker})` : ''}`;
  const row = {
    run_id: record.runId,
    call_type: record.callType,
    ticker: record.ticker ?? null,
    model: record.model,
    system_prompt: record.systemPrompt,
    user_prompt: record.userPrompt,
    raw_response: record.rawResponse,
    usage: record.usage,
    cost_usd: record.costUsd,
    latency_ms: record.latencyMs,
  };

  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.from('llm_calls').insert(row);
    if (!error) return;
    if (attempt >= MAX_INSERT_RETRIES) {
      throw new Error(`Failed to record ${label} after ${attempt + 1} attempts: ${error.message}`);
    }
    console.warn(`Failed to record ${label} (attempt ${attempt + 1}/${MAX_INSERT_RETRIES + 1}), retrying:`, error.message);
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
}
