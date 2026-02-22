import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getLargestStockDips } from './fetchTopDips.js';

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 2);

  const largestDips = await getLargestStockDips(targetDate, 10, 10000000);
  largestDips.forEach(dip => {
    console.log(dip);
  })
}

main();