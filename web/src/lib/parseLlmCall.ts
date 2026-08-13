import type { LlmCall } from '../types';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export interface ParsedAnalysis {
  reasoning: string;
  keyFactors: string[];
  conviction: 'strong' | 'moderate' | 'weak';
}

export interface ParsedJudgePick {
  ticker: string;
  reasoning: string;
}

function textBlocks(rawResponse: unknown): string[] {
  const content = (rawResponse as { content?: AnthropicContentBlock[] } | null)?.content ?? [];
  return content
    .filter((block): block is AnthropicContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text);
}

// The last text block, matching parseWithRetry.ts — a response that searched again after
// drafting an answer holds several complete drafts, and only the final one is what the
// pipeline parsed and acted on.
function extractText(rawResponse: unknown): string {
  return textBlocks(rawResponse).at(-1) ?? '';
}

// Market context is free-form prose, and a web_search response splits it across
// many text blocks (one per search-interleaved segment). `fetchMarketContext.ts`
// joins them all; showing only the first would drop ~90% of the summary.
export function parseMarketContext(call: LlmCall): string {
  return textBlocks(call.raw_response).join('');
}

export function parseAnalysis(call: LlmCall): ParsedAnalysis | null {
  try {
    return JSON.parse(extractText(call.raw_response)) as ParsedAnalysis;
  } catch {
    return null;
  }
}

export function parseJudgePicks(call: LlmCall): ParsedJudgePick[] {
  try {
    return JSON.parse(extractText(call.raw_response)) as ParsedJudgePick[];
  } catch {
    return [];
  }
}
