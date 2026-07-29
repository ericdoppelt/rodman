import Anthropic from '@anthropic-ai/sdk';
import { anthropicResponseSchema, type TextBlock } from './schemas.js';
import { trackUsage, calculateCallCost } from './usageTracker.js';
import { recordLlmCall, type RunRecordContext } from './db/llmCallStore.js';

const SYSTEM_PROMPT = `You are an expert financial market research analyst with deep knowledge of macroeconomic conditions, sector trends, and market-moving events.

Your job is to research macro market conditions for a given trading day to explain why certain stocks may have dropped significantly.

CRITICAL INSTRUCTIONS:
- Do NOT narrate your research process
- Do NOT say "I will search" or "Let me look up" or "Based on my research"
- Search silently, then write ONE cohesive summary at the end
- Your entire response should be a single well-structured summary

Focus on:
- Overall market direction and sentiment (broad selloff vs isolated drops)
- Major macro events (Fed decisions, inflation data, jobs reports, earnings seasons)
- Sector-specific trends (which sectors were up or down and why)
- Any major geopolitical or news events impacting markets

Be concise. Only include information relevant to explaining why stocks dropped that day.`;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;
const TOOLS: Anthropic.Messages.WebSearchTool20250305[] = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 1
  }
];
const TIMEOUT = 180_000;

/**
 * Exposed method to get market context for a given day.
 * @param client is the Anthropic tool to use with keys credentialed.
 * @param date is the date to get context on.
 * @returns a string containing market context. 
 */
export async function getMarketContext(client: Anthropic, date: Date, record?: RunRecordContext): Promise<string> {
  const formattedDate = date.toISOString().split('T')[0];
  const userPrompt = `Research and summarize the macro market conditions for ${formattedDate}. What was happening in the market that day that could explain significant stock drops?`;

  const startTime = performance.now();
  const rawResponse = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: [{
      role: 'user',
      content: userPrompt
    }]
  }, {
    timeout: TIMEOUT, // per request timeout
  }).catch(error => {
    console.error('Failed to fetch market context for date:', formattedDate, error);
    throw error;
  });
  const latencyMs = Math.round(performance.now() - startTime);

  trackUsage(MODEL, rawResponse.usage);

  if (record) {
    await recordLlmCall(record.supabase, {
      runId: record.runId,
      callType: 'market_context',
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      rawResponse,
      usage: rawResponse.usage,
      costUsd: calculateCallCost(MODEL, rawResponse.usage),
      latencyMs,
    });
  }

  const parsed = anthropicResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(
      `Anthropic response did not match expected shape for date ${formattedDate}: ${parsed.error.message}`
    );
  }
  
  const textBlocks = parsed.data.content.filter(
    (block): block is TextBlock => block.type === 'text'
  );

  if (textBlocks.length === 0) {
    throw new Error(`No text response from market context agent for date: ${formattedDate}`);
  }

  return textBlocks.map(tb => tb.text).join('');
}