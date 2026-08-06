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

function extractText(rawResponse: unknown): string {
  const content = (rawResponse as { content?: AnthropicContentBlock[] } | null)?.content ?? [];
  const textBlock = content.find((block): block is AnthropicContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string');
  return textBlock?.text ?? '';
}

export function parseMarketContext(call: LlmCall): string {
  return extractText(call.raw_response);
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
