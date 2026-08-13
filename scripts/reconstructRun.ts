/**
 * One-off: finish a run that died after its research completed.
 *
 * 2026-08-04 recorded market context and all ten bull/bear pairs, then lost the judge call to
 * a 529 (`overloaded_error`) and was marked failed — stranding $0.34 of usable analysis and
 * hiding the run from the site, since RLS only exposes completed runs.
 *
 * This replays the stored judge prompt against the stored research. Nothing is re-researched
 * and no new evidence enters: the judge has no tools, and its user prompt is the one recorded
 * at the time. Hindsight is not a concern for runs after the model's training cutoff, but the
 * decision is still a fresh draw made days later, not the one that was lost — replays are not
 * deterministic (a 2026-08-11 replay picked a stock the original declined). So:
 *
 *   - `runs.reconstructed_at` and `picks.reconstructed_at` are set, and the UI labels both.
 *   - `runs.error` is left populated as the record of the original failure.
 *   - No Alpaca order is placed, and reconstructed picks are excluded from performance stats.
 *   - The new judge call IS written to `llm_calls` — it is a real call that really happened,
 *     and its created_at makes plain that it happened later.
 *
 * Usage: pnpm exec tsx scripts/reconstructRun.ts --date 2026-08-04 [--apply]
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/db/supabaseClient.js';
import { judgeOutputSchema, stockAnalysisSchema, type StockResearch } from '../src/schemas.js';
import { JUDGE_SYSTEM_PROMPT, MODEL, MAX_TOKENS, _getUserPrompt } from '../src/judgeResearch.js';
import { parseWithRetry } from '../src/parseWithRetry.js';
import { calculateCallCost } from '../src/usageTracker.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const dateArg = process.argv[process.argv.indexOf('--date') + 1];
if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  throw new Error('pass --date YYYY-MM-DD');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const supabase = createSupabaseClient();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select('id, run_date, status, error, reconstructed_at, picks(id), llm_calls(id, call_type, ticker, user_prompt, raw_response, cost_usd)')
    .eq('run_date', dateArg);
  if (runsError) throw new Error(runsError.message);

  const run = (runs ?? []).find((r: any) => r.status === 'failed') as any;
  if (!run) throw new Error(`no failed run on ${dateArg}`);
  if (run.reconstructed_at) throw new Error(`${dateArg} was already reconstructed at ${run.reconstructed_at}`);
  if (run.picks.length > 0) throw new Error(`${dateArg} already has picks — refusing to touch it`);

  if (run.llm_calls.some((c: any) => c.call_type === 'judge')) {
    throw new Error(`${dateArg} already has a judge call — this script is for runs that lost it`);
  }

  const research = run.llm_calls;
  // The judge call never happened, so its prompt was never stored. Rebuild it from the stored
  // bull/bear pairs using the production template, so the replay sees exactly what the original
  // judge would have seen. percentageChange is recovered from the research prompt, which reads
  // "... which dropped -12.62% on <date> with volume of ...".
  const byTicker = new Map<string, { bull?: any; bear?: any; percentageChange?: number }>();
  for (const call of research) {
    if (call.call_type !== 'bull' && call.call_type !== 'bear') continue;
    const entry = byTicker.get(call.ticker) ?? {};

    const text = (call.raw_response?.content ?? [])
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .at(-1)?.text;
    const analysis = stockAnalysisSchema.safeParse(JSON.parse(text));
    if (!analysis.success) throw new Error(`${call.call_type} ${call.ticker}: stored analysis does not parse — ${analysis.error.issues[0]?.message}`);
    entry[call.call_type as 'bull' | 'bear'] = analysis.data;

    const pct = /dropped (-?[\d.]+)%/.exec(call.user_prompt ?? '');
    if (pct) entry.percentageChange = Number(pct[1]);

    byTicker.set(call.ticker, entry);
  }

  const stockResearch: StockResearch[] = [];
  for (const [ticker, entry] of byTicker) {
    if (!entry.bull || !entry.bear || entry.percentageChange === undefined) {
      console.log(`  skipping ${ticker} — incomplete stored research`);
      continue;
    }
    stockResearch.push({
      // Only ticker and percentageChange are read by the judge template; the rest of
      // StockChange is not recoverable from what was stored and is not used here.
      stockChange: { ticker, open: 0, close: 0, percentageChange: entry.percentageChange, volume: 0 },
      bull: entry.bull,
      bear: entry.bear,
    });
  }
  if (stockResearch.length === 0) throw new Error(`${dateArg}: no complete bull/bear pairs to judge`);

  const judgePrompt = _getUserPrompt(stockResearch, dateArg);
  console.log(`${dateArg}: ${research.length} stored research calls, ${stockResearch.length} complete pairs rebuilt`);
  console.log(`  original error: ${String(run.error).slice(0, 100)}\n`);

  const startTime = performance.now();
  const { response, parsedOutput } = await parseWithRetry(client, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: JUDGE_SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(judgeOutputSchema) },
    messages: [{ role: 'user', content: judgePrompt }],
  }, { timeout: 180_000 });
  const latencyMs = Math.round(performance.now() - startTime);
  const costUsd = calculateCallCost(MODEL, response.usage);

  if (parsedOutput.picks.length > 0) {
    for (const pick of parsedOutput.picks) console.log(`PICK ${pick.ticker}: ${pick.reasoning}`);
  } else {
    console.log(`NO PICK: ${parsedOutput.noPickReason}`);
  }
  console.log(`\njudge call: ${latencyMs}ms, $${costUsd.toFixed(4)}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Pass --apply to commit.');
    return;
  }

  const now = new Date().toISOString();

  const { error: callError } = await supabase.from('llm_calls').insert({
    run_id: run.id,
    call_type: 'judge',
    model: MODEL,
    system_prompt: JUDGE_SYSTEM_PROMPT,
    user_prompt: judgePrompt,
    raw_response: response,
    usage: response.usage,
    cost_usd: costUsd,
    latency_ms: latencyMs,
  });
  if (callError) throw new Error(`judge call insert failed: ${callError.message}`);

  if (parsedOutput.picks.length > 0) {
    const { error: pickError } = await supabase.from('picks').insert(
      parsedOutput.picks.map(pick => ({
        run_id: run.id,
        ticker: pick.ticker,
        reasoning: pick.reasoning,
        reconstructed_at: now,
      }))
    );
    if (pickError) throw new Error(`pick insert failed: ${pickError.message}`);
  }

  const totalCost = research.reduce((n: number, c: any) => n + Number(c.cost_usd), 0) + costUsd;
  const { error: runError } = await supabase
    .from('runs')
    .update({
      status: 'completed',
      total_cost_usd: totalCost.toFixed(6),
      reconstructed_at: now,
      ...(parsedOutput.picks.length === 0
        ? { no_pick_reason: parsedOutput.noPickReason, no_pick_reason_backfilled_at: now }
        : {}),
    })
    .eq('id', run.id);
  if (runError) throw new Error(`run update failed: ${runError.message}`);

  console.log(`\nWritten. Run marked completed, total_cost_usd $${totalCost.toFixed(4)}, reconstructed_at ${now}.`);
  console.log('No Alpaca order placed. Run `pnpm backfill-entry-prices` to set the entry price.');
}

main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
