import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { type StockChange, type Stance, type NewsItem, stockAnalysisSchema, type StockAnalysis, type StockResearch } from '../schemas.js';
import { trackUsage } from '../usageTracker.js';
import { BULL_SYSTEM_PROMPT, BEAR_SYSTEM_PROMPT, MODEL, MAX_TOKENS, TIMEOUT } from '../stockAgents.js';
import { getHistoricalNews } from './fetchHistoricalNews.js';
import { parseWithRetry } from '../parseWithRetry.js';

/**
 * Backtest-mode research: same bull/bear system prompts, model, and output schema as
 * production (`stockAgents.ts`) — the only thing that changes is where evidence comes from.
 * Production uses live `web_search`, which can't be restricted to a historical date and would
 * leak post-date information into the analysis. Here, evidence is Tavily search results
 * filtered to `end_date <= date`, passed directly as text (no tool call), so nothing the model
 * sees could postdate the event being analyzed.
 */
function _getBacktestUserPrompt(stockChange: StockChange, marketContext: string, date: Date, news: NewsItem[]): string {
  const newsBlock = news.length > 0
    ? news.map(n => `- [${n.published_utc.slice(0, 10)}] ${n.title}${n.description ? ` — ${n.description}` : ''}`).join('\n')
    : '(no news found for this ticker published on or before this date)';

  return `Analyze ${stockChange.ticker} which dropped ${stockChange.percentageChange.toFixed(2)}% on ${date} with volume of ${stockChange.volume.toLocaleString()}.

      Market conditions on ${date}:
      ${marketContext}

      News about ${stockChange.ticker} published on or before ${date}:
      ${newsBlock}

      Make your case using only the information above — do not speculate about news or price action beyond it. Focus on what caused this drop on ${date} and whether it represents an overreaction or justified decline.`;
}

async function _analyzeStockChangeWithStanceBacktest(client: Anthropic, stockChange: StockChange, stance: Stance, marketContext: string, date: Date, news: NewsItem[], model: string): Promise<StockAnalysis> {
  const systemPrompt: string = stance === 'bull' ? BULL_SYSTEM_PROMPT : BEAR_SYSTEM_PROMPT;
  const userPrompt = _getBacktestUserPrompt(stockChange, marketContext, date, news);

  const { parsedOutput } = await parseWithRetry(
    client,
    {
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      // No tools: evidence is provided directly as point-in-time news text above.
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
    attemptResponse => trackUsage(model, attemptResponse.usage),
  ).catch(error => {
    console.error(`Error analyzing (backtest) ${stockChange.ticker} for the ${stance} stance`, error);
    throw error;
  });

  if (!parsedOutput) {
    throw new Error(`No parsed output (backtest) for ${stockChange.ticker} and ${stance} stance`);
  }

  return parsedOutput;
}

async function _researchStockBacktest(client: Anthropic, stockChange: StockChange, marketContext: string, date: Date, news: NewsItem[], model: string): Promise<StockResearch> {
  const [bullAnalysis, bearAnalysis] = await Promise.all([
    _analyzeStockChangeWithStanceBacktest(client, stockChange, 'bull', marketContext, date, news, model),
    _analyzeStockChangeWithStanceBacktest(client, stockChange, 'bear', marketContext, date, news, model)
  ]).catch(error => {
    console.error(`Unable to research (backtest) stock ${stockChange.ticker}`, error);
    throw error;
  });

  return {
    stockChange: stockChange,
    bull: bullAnalysis,
    bear: bearAnalysis
  };
}

/**
 * Backtest equivalent of `researchStockChanges`. Candidates run concurrently — firing every
 * ticker's news lookup at once instead of awaiting one fully before starting the next lets each
 * candidate's Claude research overlap with the rest of the news fetching instead of adding on
 * top of it serially. `newsLookup` defaults to the live Tavily call but can be swapped for a
 * cache-backed lookup (see dailyCache.ts) to skip network calls entirely on a cache hit. `model`
 * defaults to production's bull/bear model but can be overridden (see runBacktest.ts's
 * BACKTEST_BULL_BEAR_MODEL) to iterate on the harness cheaply before a final scored run.
 */
export async function researchStockChangesBacktest(
  client: Anthropic,
  stockChanges: StockChange[],
  marketContextPromise: Promise<string>,
  date: Date,
  newsLookup: (ticker: string, date: Date) => Promise<NewsItem[]> = getHistoricalNews,
  model: string = MODEL,
): Promise<StockResearch[]> {
  return Promise.all(stockChanges.map(async stockChange => {
    const news = await newsLookup(stockChange.ticker, date);
    const marketContext = await marketContextPromise;
    return _researchStockBacktest(client, stockChange, marketContext, date, news, model);
  }));
}
