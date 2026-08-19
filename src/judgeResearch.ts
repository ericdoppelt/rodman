import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type JudgeOutput, type StockResearch, judgeOutputSchema, MAX_PICKS } from './schemas.js';
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
// worth retrying in a few weeks, or asking Anthropic support. Either way, a summary is not a
// commitment — which is why `judgeOutputSchema` requires `noPickReason` instead: the model has
// to state its reason in its own output, where it is validated and stored.

// The old first rule read "Only include a stock if you have STRONG conviction it is a buying
// opportunity". Paired with a bull agent that could not say "strong" (see stockAgents.ts), that
// asked for a level of certainty the inputs could not express, and the run declined 6 times in 7
// sessions to 2026-08-17. The bar is now the balance of evidence. The empty array is still
// available and still preferred on weak evidence — declining is meant to be possible, not default.
export const JUDGE_SYSTEM_PROMPT = `You are a decisive senior investment analyst tasked with identifying the best buying opportunities from a set of stocks that dropped significantly in a single day.

You will be given bull and bear cases for each stock. Your job is to evaluate the arguments and recommend at most ${MAX_PICKS} stock(s) to buy.

Rules:
- Include a stock if the evidence, on balance, supports it being a buying opportunity
- Return an empty picks array if no stock is a buying opportunity — this is the preferred outcome when evidence is weak
- Maximum ${MAX_PICKS} stock(s) in picks
- reasoning must be concise — 2-3 sentences maximum
- When picks is empty you MUST set noPickReason, explaining in 2-3 sentences what specifically fell short. Name the tickers you came closest to picking and what would have had to be different. Do not restate the rules or say only that conviction was insufficient.`;

// Exported so scripts/reconstructRun.ts can rebuild this prompt verbatim for a run whose judge
// call never happened — a copy of the template there would silently drift from this one.
export function _getUserPrompt(stockResearch: StockResearch[], formattedDate: string | undefined) {
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

export async function pickStock(client: Anthropic, stockResearch: StockResearch[], date: Date, record?: RunRecordContext, model: string = MODEL): Promise<JudgeOutput> {
    const formattedDate = date.toISOString().split('T')[0];

    const userPrompt = _getUserPrompt(stockResearch, formattedDate);
    const startTime = performance.now();
    const { parsedOutput } = await parseWithRetry(client, {
        model,
        max_tokens: MAX_TOKENS,
        system: JUDGE_SYSTEM_PROMPT,
        tools: TOOLS,
        output_config: {
            format: zodOutputFormat(judgeOutputSchema)
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

    // Both halves are returned: callers persist `noPickReason` onto the run so a declined day
    // is queryable in SQL, not just readable by digging into the judge call's raw_response.
    return parsedOutput;
}




