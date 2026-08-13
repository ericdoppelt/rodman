import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { splitDayMove, type StockChange, type Stance, stockAnalysisSchema, type StockAnalysis, type StockResearch, type RejectedCandidate } from './schemas.js';
import { trackUsage, calculateCallCost } from './usageTracker.js';
import { recordLlmCall, type RunRecordContext } from './db/llmCallStore.js';
import { recordRejectedCandidate } from './db/runStore.js';
import { parseWithRetry } from './parseWithRetry.js';

export const BULL_SYSTEM_PROMPT = `You are a balanced analyst tasked with making the strongest possible bull case for why a stock that dropped significantly represents a buying opportunity.

Rules:
- reasoning must be a non-empty string
- keyFactors must have between 3 and 5 items
- conviction reflects the strength of the EVIDENCE you found, not your enthusiasm. Use "weak" if evidence is thin or mixed, "moderate" if reasonable but not compelling, "strong" only if evidence clearly supports a buying opportunity
- Focus your research on the specific date provided in the user message
- If you need to search, search silently
- Do not include citation tags like <cite> in your response
- Write reasoning in plain prose without any XML or HTML tags`;

export const BEAR_SYSTEM_PROMPT = `You are a balanced analyst tasked with making the strongest possible bear case for why a stock that dropped significantly should NOT be bought.

Rules:
- reasoning must be a non-empty string
- keyFactors must have between 3 and 5 items
- conviction reflects the strength of the EVIDENCE you found, not your enthusiasm
- Focus your research on the specific date provided in the user message
- If you need to search, search silently
- Do not include citation tags like <cite> in your response
- Write reasoning in plain prose without any XML or HTML tags`;

export const MODEL = 'claude-haiku-4-5-20251001';
export const MAX_TOKENS = 4096;
// Haiku 4.5 predates adaptive thinking — `{type: 'adaptive'}` and `output_config.effort`
// both error on it, so the budgeted form is the only one available. Without a thinking
// block the schema-constrained JSON is the model's only output channel, so "let me search
// once more and reconsider" can only be expressed as a second complete answer: 44 of 244
// bull/bear calls emitted duplicate drafts that way. budget_tokens counts against
// MAX_TOKENS; 2048 leaves ~1200 tokens of headroom over the longest analysis seen (850).
const THINKING: Anthropic.Messages.ThinkingConfigParam = {
    type: 'enabled',
    budget_tokens: 2048
};
const TOOLS: Anthropic.Messages.WebSearchTool20250305[] = [
    {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3
    }
];
export const TIMEOUT = 180_000;

function _getUserPrompt(stockChange: StockChange, marketContext: string, date: Date): string {
    const company = stockChange.companyName ? ` (${stockChange.companyName})` : '';
    // Candidates are ranked on the intraday move alone (see docs/decisions/0017), but stating only
    // that number misdescribes the day whenever the drop began overnight. BLLN's bear case openly
    // contradicted its prompt — "goes well beyond the modest 12.85% figure mentioned in the prompt"
    // — because the real move was 39%, most of it an after-hours earnings reaction. Give the whole
    // shape of the day and be explicit about which part the screen selected on.
    const split = splitDayMove(stockChange);
    const move = split
        ? `fell ${Math.abs(split.dayOverDayPct).toFixed(2)}% on ${date}, measured from the prior close.
That move breaks down into a ${split.gapPct >= 0 ? 'gap up' : 'gap down'} of ${split.gapPct.toFixed(2)}% overnight, then ${stockChange.percentageChange.toFixed(2)}% during the session itself.
This stock was selected for the intraday portion — sustained selling while the market was open, which is the overreaction this strategy looks for. The overnight gap is usually the market repricing on news; the intraday slide is where participants may have overshot.`
        : `dropped ${stockChange.percentageChange.toFixed(2)}% during the session on ${date} (open to close; the prior close was unavailable, so the full day-over-day move is unknown)`;

    return `<stock_change>
Analyze ${stockChange.ticker}${company}, which ${move}
Volume was ${stockChange.volume.toLocaleString()}.
</stock_change>

<market_context>
${marketContext}
</market_context>

Research ${stockChange.ticker} specifically and make your case. Focus on what caused this drop on ${date} and whether it represents an overreaction or justified decline.`;
}

async function _researchStock(client: Anthropic, stockChange: StockChange, marketContext: string, date: Date, record?: RunRecordContext): Promise<StockResearch> {
    const [bullAnalysis, bearAnalysis] = await Promise.all([
        _analyzeStockChangeWithStance(client, stockChange, 'bull', marketContext, date, record),
        _analyzeStockChangeWithStance(client, stockChange, 'bear', marketContext, date, record)
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
async function _analyzeStockChangeWithStance(client: Anthropic, stockChange: StockChange, stance: Stance, marketContext: string, date: Date, record?: RunRecordContext): Promise<StockAnalysis> {
    const systemPrompt: string = stance === 'bull' ? BULL_SYSTEM_PROMPT : BEAR_SYSTEM_PROMPT;
    const formattedDate = date.toISOString().split('T')[0];
    const userPrompt = _getUserPrompt(stockChange, marketContext, date);

    const startTime = performance.now();
    const { parsedOutput } = await parseWithRetry(
        client,
        {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            thinking: THINKING,
            tools: TOOLS,
            output_config: {
                format: zodOutputFormat(stockAnalysisSchema)
            },
            messages: [{
                role: 'user',
                content: userPrompt
            }]
        },
        {
            timeout: TIMEOUT
        },
        async attemptResponse => {
            trackUsage(MODEL, attemptResponse.usage);
            if (record) {
                await recordLlmCall(record.supabase, {
                    runId: record.runId,
                    callType: stance,
                    ticker: stockChange.ticker,
                    model: MODEL,
                    systemPrompt,
                    userPrompt,
                    rawResponse: attemptResponse,
                    usage: attemptResponse.usage,
                    costUsd: calculateCallCost(MODEL, attemptResponse.usage),
                    latencyMs: Math.round(performance.now() - startTime),
                });
            }
        },
    ).catch(error => {
        console.error(`Error analyzing stock ${stockChange.ticker} for the ${stance} stance`, error);
        throw error;
    });
    if (!parsedOutput) {
        throw new Error(`No parsed output for ${stockChange.ticker} and ${stance} stance`);
    }

    return parsedOutput;
}

export async function researchStockChanges(client: Anthropic, stockChanges: StockChange[], marketContext: string, date: Date, record?: RunRecordContext): Promise<{ research: StockResearch[]; rejected: RejectedCandidate[] }> {
    const settledResearchResults = await Promise.allSettled(stockChanges.map(stockChange => _researchStock(client, stockChange, marketContext, date, record)));

    const research: StockResearch[] = [];
    const rejected: RejectedCandidate[] = [];

    for (const [index, result] of settledResearchResults.entries()) {
        if (result.status === 'fulfilled') {
            research.push(result.value);
        } else {
            const ticker = stockChanges[index]!.ticker;
            const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
            rejected.push({ ticker, reason: 'research_failed', details: { error: errorMessage } });
            if (record) {
                await recordRejectedCandidate(record.supabase, record.runId, ticker, 'research_failed', { error: errorMessage });
            }
        }
    }

    return { research, rejected };
}