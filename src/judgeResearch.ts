import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type StockPick, type StockResearch, stockPickSchema, MAX_PICKS } from './schemas.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8096;
const TOOLS: Anthropic.Messages.WebSearchTool20250305[] = [];
const TIMEOUT = 180_000;

const JUDGE_SYSTEM_PROMPT = `You are a decisive senior investment analyst tasked with identifying the best buying opportunities from a set of stocks that dropped significantly in a single day.

You will be given bull and bear cases for each stock. Your job is to evaluate the arguments and recommend at most ${MAX_PICKS} stock(s) to buy.

Rules:
- Only include a stock if you have STRONG conviction it is a buying opportunity
- Return an empty array if no stocks meet this bar — this is the preferred outcome when evidence is weak
- Maximum ${MAX_PICKS} stock(s) in the array
- reasoning must be concise — 2-3 sentences maximum`;

function _getUserPrompt(stockResearch: StockResearch[], formattedDate: string | undefined) {
    const stockSummaries = stockResearch.map(({ stockChange, bull, bear }) => `
      ${stockChange.ticker} dropped ${stockChange.percentageChange.toFixed(2)}% on ${formattedDate}
      
      BULL CASE (${bull.conviction} conviction):
      ${bull.reasoning}
      Key factors: ${bull.keyFactors.join(', ')}
      
      BEAR CASE (${bear.conviction} conviction):
      ${bear.reasoning}
      Key factors: ${bear.keyFactors.join(', ')}
      `).join('\n---\n');

    return `Today is ${formattedDate}. Evaluate these stocks and decide which if any to recommend buying. Pick 0 stocks if you are not confident, and at most 1 if you are. \n\n${stockSummaries}`;
}

export async function pickStock(client: Anthropic, stockResearch: StockResearch[], date: Date): Promise<StockPick> {
    const formattedDate = date.toISOString().split('T')[0];

    const userPrompt = _getUserPrompt(stockResearch, formattedDate);
    const response = await client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: JUDGE_SYSTEM_PROMPT,
        tools: TOOLS,
        output_config: {
            format: zodOutputFormat(stockPickSchema)
        },
        messages: [{
            role: 'user',
            content: userPrompt
        }]
    }, {
        timeout: TIMEOUT
    }).catch(error => {
        console.error(`Failed to judge stock research for date ${date}`, error);
        throw error;
    });

    if (!response.parsed_output) {
        throw new Error(`No parsed output from judge for date ${formattedDate} (stop_reason: ${response.stop_reason})`);
    }

    return response.parsed_output;
}




