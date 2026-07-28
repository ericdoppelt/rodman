import type Anthropic from '@anthropic-ai/sdk';

interface ModelRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// $ per million tokens
const PRICING: Record<string, ModelRates> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

const usageRecords: { model: string; usage: Anthropic.Usage }[] = [];

export function trackUsage(model: string, usage: Anthropic.Usage): void {
  usageRecords.push({ model, usage });
}

export function getTotalCost(): number {
  return usageRecords.reduce((total, { model, usage }) => {
    const rates = PRICING[model];
    if (!rates) {
      console.warn(`No pricing configured for model ${model}, skipping in cost total`);
      return total;
    }

    const inputCost = (usage.input_tokens / 1_000_000) * rates.input;
    const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
    const cacheWriteCost = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * rates.cacheWrite;
    const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * rates.cacheRead;

    return total + inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }, 0);
}
