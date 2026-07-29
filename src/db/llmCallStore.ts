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

export async function recordLlmCall(supabase: SupabaseClient, record: LlmCallRecord): Promise<void> {
  const { error } = await supabase.from('llm_calls').insert({
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
  });
  if (error) {
    console.error(`Failed to record ${record.callType} LLM call${record.ticker ? ` (${record.ticker})` : ''}:`, error.message);
  }
}
