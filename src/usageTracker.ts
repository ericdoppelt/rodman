import type Anthropic from '@anthropic-ai/sdk';

interface ModelRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// $ per million tokens. Sonnet 5 uses standard (post-intro) pricing rather than the $2/$10
// promo through 2026-08-31, so this stays correct after the promo ends without needing an update.
const PRICING: Record<string, ModelRates> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

const usageRecords: { model: string; usage: Anthropic.Usage }[] = [];

export function calculateCallCost(model: string, usage: Anthropic.Usage): number {
  const rates = PRICING[model];
  if (!rates) {
    console.warn(`No pricing configured for model ${model}, skipping in cost total`);
    return 0;
  }

  const inputCost = (usage.input_tokens / 1_000_000) * rates.input;
  const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
  const cacheWriteCost = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * rates.cacheWrite;
  const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * rates.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export function trackUsage(model: string, usage: Anthropic.Usage): void {
  usageRecords.push({ model, usage });
}

export function getTotalCost(): number {
  return usageRecords.reduce((total, { model, usage }) => total + calculateCallCost(model, usage), 0);
}
