import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { type StockChange, type Stance, type PolygonNewsItem, stockAnalysisSchema, type StockAnalysis, type StockResearch } from '../schemas.js';
import { trackUsage } from '../usageTracker.js';
import { BULL_SYSTEM_PROMPT, BEAR_SYSTEM_PROMPT, MODEL, MAX_TOKENS, TIMEOUT } from '../stockAgents.js';
import { getHistoricalNews } from './fetchHistoricalNews.js';

/**
 * Backtest-mode research: same bull/bear system prompts, model, and output schema as
 * production (`stockAgents.ts`) — the only thing that changes is where evidence comes from.
 * Production uses live `web_search`, which can't be restricted to a historical date and would
 * leak post-date information into the analysis. Here, evidence is Polygon news filtered to
 * `published_utc <= date`, passed directly as text (no tool call), so nothing the model sees
 * could postdate the event being analyzed.
 */
function _getBacktestUserPrompt(stockChange: StockChange, marketContext: string, date: Date, news: PolygonNewsItem[]): string {
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

async function _analyzeStockChangeWithStanceBacktest(client: Anthropic, stockChange: StockChange, stance: Stance, marketContext: string, date: Date, news: PolygonNewsItem[]): Promise<StockAnalysis> {
  const systemPrompt: string = stance === 'bull' ? BULL_SYSTEM_PROMPT : BEAR_SYSTEM_PROMPT;
  const userPrompt = _getBacktestUserPrompt(stockChange, marketContext, date, news);

  const response = await client.messages.parse(
    {
      model: MODEL,
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
    }).catch(error => {
      console.error(`Error analyzing (backtest) ${stockChange.ticker} for the ${stance} stance`, error);
      throw error;
    });

  trackUsage(MODEL, response.usage);

  if (!response.parsed_output) {
    throw new Error(`No parsed output (backtest) for ${stockChange.ticker} and ${stance} stance (stop_reason: ${response.stop_reason})`);
  }

  return response.parsed_output;
}

async function _researchStockBacktest(client: Anthropic, stockChange: StockChange, marketContext: string, date: Date, news: PolygonNewsItem[]): Promise<StockResearch> {
  const [bullAnalysis, bearAnalysis] = await Promise.all([
    _analyzeStockChangeWithStanceBacktest(client, stockChange, 'bull', marketContext, date, news),
    _analyzeStockChangeWithStanceBacktest(client, stockChange, 'bear', marketContext, date, news)
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
 * Backtest equivalent of `researchStockChanges` — serialized (not parallel across tickers)
 * because each stock needs its own rate-limited Polygon news call first.
 */
export async function researchStockChangesBacktest(client: Anthropic, stockChanges: StockChange[], marketContext: string, date: Date): Promise<StockResearch[]> {
  const results: StockResearch[] = [];
  for (const stockChange of stockChanges) {
    const news = await getHistoricalNews(stockChange.ticker, date);
    const research = await _researchStockBacktest(client, stockChange, marketContext, date, news);
    results.push(research);
  }
  return results;
}
