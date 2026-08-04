import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { StockResearch } from '../schemas.js';
import { trackUsage } from '../usageTracker.js';
import { parseWithRetry } from '../parseWithRetry.js';
import { DIPS_PER_DAY } from './backtestConfig.js';

// Backtest-only alternate judge strategy (see BACKTEST_STRATEGY in runBacktest.ts). Production's
// judge (judgeResearch.ts, MAX_PICKS=1) asks "which single stock is the best buy" — this instead
// asks "which of these would you NOT buy," defaulting to buying every candidate and excluding one
// only for a genuine fundamental flaw. Tests a different hypothesis: whether the judge adds value
// by screening out real duds rather than by picking a single winner. Never runs outside
// `pnpm backtest` — production's judgeResearch.ts/schemas.ts are untouched.

export const eliminationPickSchema = z.array(z.object({
  ticker: z.string().min(1),
  reasoning: z.string().min(1),
})).max(DIPS_PER_DAY);

export type EliminationPicks = z.infer<typeof eliminationPickSchema>;

export const ELIMINATION_JUDGE_SYSTEM_PROMPT = `You are a senior investment analyst evaluating a set of stocks that each dropped significantly in a single day.

Default assumption: buy every stock in the set. A large single-day drop is usually a buying opportunity, and your job is NOT to pick the single best candidate — it is to screen out the rare one that is a genuine mistake to buy.

Only EXCLUDE a stock if there is a specific, fundamental flaw: hard evidence of an accounting, legal, or solvency problem; a structural breakdown in the business (not just a bad quarter); or clear evidence the drop reflects a permanent impairment rather than an overreaction. A merely weaker bull case, an unconfirmed bear case, or lower conviction relative to the other candidates is NOT grounds for exclusion. When in doubt, keep it.

Rules:
- Return the array of tickers you would buy — normally this is ALL of the candidates given
- For each returned ticker, reasoning is 1-2 sentences on why it clears the bar (or simply that no fundamental flaw was found)
- Any candidate you omit is being excluded — only omit one for a specific fundamental reason, not general caution`;

function _getUserPrompt(stockResearch: StockResearch[], formattedDate: string | undefined): string {
  const stockSummaries = stockResearch.map(({ stockChange, bull, bear }) => `
    ${stockChange.ticker} dropped ${stockChange.percentageChange.toFixed(2)}% on ${formattedDate}

    BULL CASE (${bull.conviction} conviction):
    ${bull.reasoning}
    Key factors: ${bull.keyFactors.join(', ')}

    BEAR CASE (${bear.conviction} conviction):
    ${bear.reasoning}
    Key factors: ${bear.keyFactors.join(', ')}
    `).join('\n---\n');

  return `Today is ${formattedDate}. There are ${stockResearch.length} candidates below. Default to buying all of them — only exclude one if you find a genuine fundamental flaw.\n\n${stockSummaries}`;
}

export async function pickStocksEliminatingLosers(client: Anthropic, stockResearch: StockResearch[], date: Date, model: string): Promise<EliminationPicks> {
  const formattedDate = date.toISOString().split('T')[0];
  const userPrompt = _getUserPrompt(stockResearch, formattedDate);

  const { parsedOutput } = await parseWithRetry(client, {
    model,
    max_tokens: 8096,
    system: ELIMINATION_JUDGE_SYSTEM_PROMPT,
    tools: [],
    output_config: {
      format: zodOutputFormat(eliminationPickSchema),
    },
    messages: [{
      role: 'user',
      content: userPrompt,
    }],
  }, {
    timeout: 180_000,
  }, async attemptResponse => {
    trackUsage(model, attemptResponse.usage);
  }).catch(error => {
    console.error(`Failed to run elimination judge for date ${date}`, error);
    throw error;
  });

  if (!parsedOutput) {
    throw new Error(`No parsed output from elimination judge for date ${formattedDate}`);
  }

  return parsedOutput;
}
