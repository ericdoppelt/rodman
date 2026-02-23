import Anthropic from "@anthropic-ai/sdk";
import { type StockChange, type Stance, anthropicResponseSchema, stockAnalysisSchema, type StockAnalysis, type TextBlock, type StockResearch } from './schemas.js';

const BULL_SYSTEM_PROMPT = `You are a balanced analyst tasked with making the strongest possible bull case for why a stock that dropped significantly represents a buying opportunity.

You must respond with a JSON object matching this exact schema:
{
  "reasoning": "detailed prose analysis of why this is a buying opportunity",
  "keyFactors": ["factor 1", "factor 2", "factor 3"],
  "conviction": "strong" | "moderate" | "weak"
}

Rules:
- reasoning must be a non-empty string
- keyFactors must have between 3 and 5 items
- conviction must be exactly "strong", "moderate", or "weak"
- conviction reflects the strength of the EVIDENCE you found, not your enthusiasm. Use "weak" if evidence is thin or mixed, "moderate" if reasonable but not compelling, "strong" only if evidence clearly supports a buying opportunity
- Focus your research on the specific date provided in the user message
- Respond with JSON only. No markdown. No backticks. No other text.
- If you need to search, search silently. Do not write any text before or after the JSON object.
- Do not include citation tags like <cite> in your response
- Write reasoning in plain prose without any XML or HTML tags
- Your entire response must be a single valid JSON object and nothing else.`;

const BEAR_SYSTEM_PROMPT = `You are a balanced analyst tasked with making the strongest possible bear case for why a stock that dropped significantly should NOT be bought.

You must respond with a JSON object matching this exact schema:
{
  "reasoning": "detailed prose analysis of why this drop is justified or further downside is likely",
  "keyFactors": ["factor 1", "factor 2", "factor 3"],
  "conviction": "strong" | "moderate" | "weak"
}

Rules:
- reasoning must be a non-empty string
- keyFactors must have between 3 and 5 items
- conviction must be exactly "strong", "moderate", or "weak"
- conviction reflects the strength of the EVIDENCE you found, not your enthusiasm
- Focus your research on the specific date provided in the user message
- Respond with JSON only. No markdown. No backticks. No other text.
- If you need to search, search silently. Do not write any text before or after the JSON object.
- Do not include citation tags like <cite> in your response
- Write reasoning in plain prose without any XML or HTML tags
- Your entire response must be a single valid JSON object and nothing else.`;

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

function _getUserPrompt(stockChange: StockChange, marketContext: string, date: Date): string {
    return `Analyze ${stockChange.ticker} which dropped ${stockChange.percentageChange.toFixed(2)}% on ${date} with volume of ${stockChange.volume.toLocaleString()}.
      
      Market conditions on ${date}:
      ${marketContext}
      
      Research ${stockChange.ticker} specifically and make your case. Focus on what caused this drop on ${date} and whether it represents an overreaction or justified decline.`;
}

async function _researchStock(client: Anthropic, stockChange: StockChange, marketContext: string, date: Date): Promise<StockResearch> {
    const [bullAnalysis, bearAnalysis] = await Promise.all([
        _analyzeStockChangeWithStance(client, stockChange, 'bull', marketContext, date),
        _analyzeStockChangeWithStance(client, stockChange, 'bear', marketContext, date)
    ]).catch(error => {
        console.error(`Unable to research stock ${stockChange.ticker}`, error);
        throw error;
    });

    return {
        stockChange: stockChange,
        bull: bullAnalysis,
        bear: bearAnalysis
    }
}

/**
 * Exposed method to anaylze a stock change for a given day.
 * @param client  is the Anthropic tool with keys credentialed.
 * @param stockChange is the StockChange to investigate.
 * @param stance is the perspective to take (bull or bear).
 * @param marketContext is the macro economic conditions for that day.
 * @returns a StockAnalysis indicating the stance, reasoning, key factors, and overall conviction.
 */
async function _analyzeStockChangeWithStance(client: Anthropic, stockChange: StockChange, stance: Stance, marketContext: string, date: Date): Promise<StockAnalysis> {
    const systemPrompt: string = stance === 'bull' ? BULL_SYSTEM_PROMPT : BEAR_SYSTEM_PROMPT;
    const formattedDate = date.toISOString().split('T')[0];
    const userPrompt = _getUserPrompt(stockChange, marketContext, date);

    const rawResponse = await client.messages.create(
        {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            tools: TOOLS,
            messages: [{
                role: 'user',
                content: userPrompt
            }]
        },
        {
            timeout: TIMEOUT
        }).catch(error => {
            console.error(`Error analyzing stock ${stockChange.ticker} for the ${stance} stance`, error);
            throw error;
        });

    const parsed = anthropicResponseSchema.safeParse(rawResponse);

    if (!parsed.success) {
        throw new Error(
            `Anthropic response did not match expected shape for ${stockChange.ticker} for the ${stance} stance`
        );
    }

    const textBlocks = parsed.data.content.filter(
        (block): block is TextBlock => block.type === 'text'
    );

    if (textBlocks.length === 0) {
        throw new Error(`No text response from market context agent for date: ${formattedDate}`);
    }

    const joinedText = textBlocks.map(tb => tb.text).join('');
    const cleanJson = joinedText.replace(/```json|```/g, '').trim();
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(`No JSON found in response for ${stockChange.ticker} and ${stance} stance`);
      }
    // Extract JSON object even if Claude narrated around it
    const parsedJson = JSON.parse(jsonMatch[0]);
    const parsedJsonValidation = stockAnalysisSchema.safeParse(parsedJson);

    if (!parsedJsonValidation.success) {
        throw new Error(
            `JSON response for ${stockChange.ticker} and ${stance} stance did not match expected shape`
        );
    }

    return parsedJsonValidation.data;
}

export async function researchStockChanges(client: Anthropic, stockChanges: StockChange[], marketContext: string, date: Date): Promise<StockResearch[]> {
    const settledResearchResults = await Promise.allSettled(stockChanges.map(stockChange => _researchStock(client, stockChange, marketContext, date)))
    const filteredFulfilledResearchResults = settledResearchResults.filter((result): result is PromiseFulfilledResult<StockResearch> => result.status === 'fulfilled');
    return filteredFulfilledResearchResults.map(res => res.value);
}