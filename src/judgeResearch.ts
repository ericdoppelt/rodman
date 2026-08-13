import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type StockPick, type StockResearch, stockPickSchema, MAX_PICKS } from './schemas.js';
import { trackUsage, calculateCallCost } from './usageTracker.js';
import { recordLlmCall, type RunRecordContext } from './db/llmCallStore.js';
import { parseWithRetry } from './parseWithRetry.js';

export const MODEL = 'claude-opus-5';
export const MAX_TOKENS = 8096;
const TOOLS: Anthropic.Messages.WebSearchTool20250305[] = [];
const TIMEOUT = 180_000;

// No `thinking` config here on purpose. Opus 5 thinks by default but returns
// `thinking: ""`, because `display` defaults to "omitted" — hence the empty thinking block
// on every stored judge call. Per Anthropic's docs, `display: "summarized"` should return a
// readable summary on Opus 5, but as of 2026-08-13 it returns nothing against this API key.
// Ruled out: our request shape (empty with and without tools/structured outputs), the SDK
// (raw fetch with no SDK returns the same empty block over HTTP 200), and the model (Opus 4.8
// returns empty too, on the docs' own verbatim example). Looks account- or platform-side —
// worth retrying in a few weeks, or asking Anthropic support. Either way, a summary
// is not a commitment: to capture why the judge picked nothing, add a no-pick reason to
// `stockPickSchema` so the model has to state it in its own output.

export const JUDGE_SYSTEM_PROMPT = `You are a decisive senior investment analyst tasked with identifying the best buying opportunities from a set of stocks that dropped significantly in a single day.

You will be given bull and bear cases for each stock. Your job is to evaluate the arguments and recommend at most ${MAX_PICKS} stock(s) to buy.

Rules:
- Only include a stock if you have STRONG conviction it is a buying opportunity
- Return an empty array if no stocks meet this bar — this is the preferred outcome when evidence is weak
- Maximum ${MAX_PICKS} stock(s) in the array
- reasoning must be concise — 2-3 sentences maximum`;

function _getUserPrompt(stockResearch: StockResearch[], formattedDate: string | undefined) {
    const stockSummaries = stockResearch.map(({ stockChange, bull, bear }) => `<stock>
${stockChange.ticker} dropped ${stockChange.percentageChange.toFixed(2)}% on ${formattedDate}

<bull_case>
Conviction: ${bull.conviction}
${bull.reasoning}
Key factors: ${bull.keyFactors.join(', ')}
</bull_case>

<bear_case>
Conviction: ${bear.conviction}
${bear.reasoning}
Key factors: ${bear.keyFactors.join(', ')}
</bear_case>
</stock>`).join('\n\n');

    return `Today is ${formattedDate}. Evaluate these stocks and decide which if any to recommend buying. Pick 0 stocks if you are not confident, and at most 1 if you are.

${stockSummaries}`;
}

export async function pickStock(client: Anthropic, stockResearch: StockResearch[], date: Date, record?: RunRecordContext, model: string = MODEL): Promise<StockPick> {
    const formattedDate = date.toISOString().split('T')[0];

    const userPrompt = _getUserPrompt(stockResearch, formattedDate);
    const startTime = performance.now();
    const { parsedOutput } = await parseWithRetry(client, {
        model,
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
    }, async attemptResponse => {
        trackUsage(model, attemptResponse.usage);
        if (record) {
            await recordLlmCall(record.supabase, {
                runId: record.runId,
                callType: 'judge',
                model,
                systemPrompt: JUDGE_SYSTEM_PROMPT,
                userPrompt,
                rawResponse: attemptResponse,
                usage: attemptResponse.usage,
                costUsd: calculateCallCost(model, attemptResponse.usage),
                latencyMs: Math.round(performance.now() - startTime),
            });
        }
    }).catch(error => {
        console.error(`Failed to judge stock research for date ${date}`, error);
        throw error;
    });

    if (!parsedOutput) {
        throw new Error(`No parsed output from judge for date ${formattedDate}`);
    }

    return parsedOutput;
}




