import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from './fetchTopDips.js';
import { getMarketContext } from './fetchMarketContext.js';
import { researchStockChanges } from './stockAgents.js';
import { pickStock } from './judgeResearch.js';

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 3);

  console.log('Fetching market context...');
  const marketContext = await getMarketContext(client, yesterday);
  console.log('Market Context:');
  console.log(marketContext);
  console.log('---');

  console.log('Fetching top dips...');
  const dips = await getLargestStockDips(yesterday, 2, 100000);
  dips.forEach(stock => {
    console.log(`${stock.ticker}: ${stock.percentageChange.toFixed(2)}% | volume: ${stock.volume.toLocaleString()}`);
  });

  console.log('Analyzing stocks...');
  const research = await researchStockChanges(client, dips, marketContext, yesterday);
  research.forEach(res => console.log(`${res.stockChange.ticker} research`, res));

  console.log('Judging research...');
  const picks = await pickStock(client, research, yesterday);
  if (picks.length === 0) {
    console.log('No stock met the bar for a recommendation today.');
  } else {
    picks.forEach(pick => console.log(`PICK: ${pick.ticker} — ${pick.reasoning}`));
  }
}

main().catch(console.error);