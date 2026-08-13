import dotenv from 'dotenv';
import axios from 'axios';
import { readDailyCache } from '../src/backtest/dailyCache.js';

dotenv.config();

// Measures how usable Tavily's evidence actually is, before any Claude call is made against it.
//
// The backtest grades a judge on bull/bear cases built from this news. If the articles are about
// other companies, or predate the drop by weeks, the run measures nothing useful — so this samples
// the real candidate set and reports two things per article: whether it is on-topic, and how close
// to the test date it was published. The number that matters is the intersection: on-topic AND
// within about a week of the drop, which is what explaining a specific day's move requires.
//
// Two query shapes are compared because it isn't yet known whether the noise comes from Tavily's
// index or from our own query — appending "stock" was observed pulling in generic market articles
// ("Webull" alone returned 1 result; "Webull Corporation (BULL) stock" returned 5 irrelevant ones).
// If name-only scores better, the fix is ours to make.
//
// No Claude calls: this costs Tavily credits (2 per call at search_depth 'advanced') and nothing else.
//
// Usage: pnpm tsx scripts/measureTavilyRelevance.ts <limit> <date> [<date> ...]

const RECENCY_BUCKETS = [
  { label: 'same day', maxDays: 0 },
  { label: '<=7d', maxDays: 7 },
  { label: '<=45d', maxDays: 45 },
] as const;

function daysBefore(publishedRaw: string | undefined, testDate: Date): number | undefined {
  if (!publishedRaw) return undefined;
  const published = new Date(publishedRaw);
  if (Number.isNaN(published.getTime())) return undefined;
  const diffMs = testDate.getTime() - published.getTime();
  return Math.floor(diffMs / 86_400_000);
}

// Deliberately crude: an article can be about Amkor without "Amkor" in the headline, so this
// undercounts. Treat the result as a floor on the true on-topic rate, not an exact measure.
function isOnTopic(title: string, ticker: string, companyName: string | undefined): boolean {
  const haystack = title.toLowerCase();
  if (haystack.includes(ticker.toLowerCase())) return true;
  if (!companyName) return false;
  const firstWord = companyName.split(/[\s,]+/)[0];
  return firstWord !== undefined && firstWord.length >= 4 && haystack.includes(firstWord.toLowerCase());
}

async function search(query: string, beforeDate: Date, apiKey: string): Promise<{ title: string; published_date?: string }[]> {
  const start = new Date(beforeDate);
  start.setDate(start.getDate() - 45);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const response = await axios.post('https://api.tavily.com/search', {
    query,
    topic: 'news',
    search_depth: 'advanced',
    start_date: fmt(start),
    end_date: fmt(beforeDate),
    max_results: 5,
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  return response.data.results ?? [];
}

async function main() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set');

  const [limitArg, ...dateKeys] = process.argv.slice(2);
  const limit = Number(limitArg);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('First argument must be the number of stocks to sample');
  if (dateKeys.length === 0) throw new Error('Pass the date keys to sample from');

  const candidates: { ticker: string; companyName: string | undefined; dateKey: string }[] = [];
  for (const dateKey of dateKeys) {
    const entry = readDailyCache(dateKey);
    if (!entry) continue;
    for (const dip of entry.dips) candidates.push({ ticker: dip.ticker, companyName: dip.companyName, dateKey });
  }
  // Every Nth candidate rather than the first N, so the sample spans the whole date range instead
  // of concentrating in whichever dates happen to be listed first.
  const stride = Math.max(1, Math.floor(candidates.length / limit));
  const sample = candidates.filter((_, i) => i % stride === 0).slice(0, limit);

  console.log(`Sampling ${sample.length} of ${candidates.length} candidates across ${dateKeys.length} dates.`);
  console.log(`~${sample.length * 2} calls, ~${sample.length * 4} credits.\n`);

  const shapes = [
    { label: 'name only', build: (t: string, n?: string) => n ?? `${t} stock` },
    { label: 'name+ticker+stock', build: (t: string, n?: string) => (n ? `${n} (${t}) stock` : `${t} stock`) },
  ];

  const tally: Record<string, { articles: number; empty: number; onTopic: number; noDate: number; buckets: Record<string, number> }> = {};
  for (const shape of shapes) {
    tally[shape.label] = { articles: 0, empty: 0, onTopic: 0, noDate: 0, buckets: Object.fromEntries(RECENCY_BUCKETS.map(b => [b.label, 0])) };
  }

  for (const [index, candidate] of sample.entries()) {
    const testDate = new Date(`${candidate.dateKey}T00:00:00.000Z`);
    for (const shape of shapes) {
      const stats = tally[shape.label]!;
      const results = await search(shape.build(candidate.ticker, candidate.companyName), testDate, apiKey)
        .catch(error => {
          console.warn(`  ${candidate.ticker} (${shape.label}) failed:`, error.response?.status ?? error.message);
          return [];
        });
      if (results.length === 0) stats.empty++;
      for (const result of results) {
        stats.articles++;
        const onTopic = isOnTopic(result.title, candidate.ticker, candidate.companyName);
        if (onTopic) stats.onTopic++;
        const age = daysBefore(result.published_date, testDate);
        if (age === undefined) { stats.noDate++; continue; }
        // Only on-topic articles count toward recency — a recent article about another company
        // is not evidence, and lumping it in would flatter the number this whole exercise exists
        // to measure honestly.
        if (!onTopic) continue;
        for (const bucket of RECENCY_BUCKETS) {
          if (age <= bucket.maxDays) stats.buckets[bucket.label]!++;
        }
      }
    }
    if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${sample.length} stocks done`);
  }

  console.log('\n=== Results ===');
  for (const shape of shapes) {
    const s = tally[shape.label]!;
    const pct = (n: number) => (s.articles === 0 ? '0%' : `${Math.round((n / s.articles) * 100)}%`);
    console.log(`\n${shape.label}`);
    console.log(`  articles returned : ${s.articles}  (empty queries: ${s.empty}/${sample.length}, undated: ${s.noDate})`);
    console.log(`  on-topic          : ${s.onTopic} (${pct(s.onTopic)})`);
    for (const bucket of RECENCY_BUCKETS) {
      console.log(`  on-topic ${bucket.label.padEnd(9)}: ${s.buckets[bucket.label]} (${pct(s.buckets[bucket.label]!)})`);
    }
  }
  console.log('\nOn-topic detection is title-match only, so these are floors, not exact rates.');
}

main().catch(error => {
  console.error('Measurement failed:', error);
  process.exit(1);
});
