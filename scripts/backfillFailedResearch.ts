/**
 * One-off: replay bull/bear calls that died before emitting their JSON.
 *
 * On 2026-08-13, HUMA's bear case and BSP's bull case both stopped with `stop_reason:
 * max_tokens` and no text block at all — MAX_TOKENS is 4096, the 2048-token thinking budget
 * counts against it, and three web searches consumed what was left, so `parseWithRetry` threw
 * "No text content block in response to parse" and both tickers were rejected as
 * `research_failed`. The judge saw 8 of 10 candidates.
 *
 * The replay is exact: it re-sends the `system_prompt` and `user_prompt` stored on the failed
 * call, so the model sees the same market context and the same day's move it saw at the time.
 * Nothing is re-screened and no new prompt is composed. What is NOT the same is the draw —
 * this is a fresh call made later, with live web search, so it can reach a different
 * conclusion than the original attempt would have. That is unavoidable; the original produced
 * no conclusion to preserve.
 *
 * Scope: research only. The judge is deliberately left alone — it already ran on the surviving
 * 8 and its no-pick reason names them individually, so re-running it would be a fresh decision
 * a day later, not a repair (see scripts/reconstructRun.ts for that path and its caveats).
 * Expect the run page to show 10 researched candidates and a judge that discusses 8.
 *
 * The failed llm_calls rows are deleted and replaced rather than kept alongside: the UI matches
 * one call per (ticker, stance), so a second row would non-deterministically win and render
 * "Not recorded."
 *
 * Usage: pnpm exec tsx scripts/backfillFailedResearch.ts --date 2026-08-13 [--apply]
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/db/supabaseClient.js';
import { stockAnalysisSchema } from '../src/schemas.js';
import { MODEL, TIMEOUT } from '../src/stockAgents.js';
import { parseWithRetry } from '../src/parseWithRetry.js';
import { calculateCallCost } from '../src/usageTracker.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const dateArg = process.argv[process.argv.indexOf('--date') + 1];
if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  throw new Error('pass --date YYYY-MM-DD');
}

// stockAgents.ts keeps these private, and they are part of what made the call fail — replaying
// with a different thinking budget or search allowance would not be a replay of the same call.
const THINKING: Anthropic.Messages.ThinkingConfigParam = { type: 'enabled', budget_tokens: 2048 };
const TOOLS: Anthropic.Messages.WebSearchTool20250305[] = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
];
// The one deliberate divergence from production. MAX_TOKENS is 4096 and that is exactly what
// broke these two calls — BSP's bull spent 4507 output tokens on thinking plus three search
// result blocks and never started its JSON. Replaying at 4096 would reproduce the failure, so
// the ceiling is doubled here. Production still runs at 4096 (see BACKLOG).
const REPLAY_MAX_TOKENS = 8192;

function parsedAnalysis(rawResponse: any): unknown | null {
  const text = (rawResponse?.content ?? [])
    .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
    .at(-1)?.text;
  if (!text) return null;
  try {
    const parsed = stockAnalysisSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const supabase = createSupabaseClient();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select(
      'id, run_date, status, total_cost_usd, llm_calls(id, call_type, ticker, model, system_prompt, user_prompt, raw_response, cost_usd), rejected_candidates(id, ticker, reason)'
    )
    .eq('run_date', dateArg);
  if (runsError) throw new Error(runsError.message);

  const run = (runs ?? [])[0] as any;
  if (!run) throw new Error(`no run on ${dateArg}`);
  if ((runs ?? []).length > 1) throw new Error(`${dateArg} has ${runs!.length} runs — ambiguous`);

  const failedTickers = (run.rejected_candidates as any[])
    .filter(r => r.reason === 'research_failed')
    .map(r => r.ticker);
  if (failedTickers.length === 0) throw new Error(`${dateArg} has no research_failed candidates`);

  // A ticker is only recovered if BOTH sides end up parseable, so collect every unparseable
  // bull/bear call belonging to a failed ticker — usually one side, but not necessarily.
  const toReplay = (run.llm_calls as any[]).filter(
    call =>
      (call.call_type === 'bull' || call.call_type === 'bear') &&
      failedTickers.includes(call.ticker) &&
      parsedAnalysis(call.raw_response) === null
  );

  console.log(`${dateArg}: research_failed on ${failedTickers.join(', ')}`);
  for (const ticker of failedTickers) {
    const sides = (run.llm_calls as any[]).filter(c => c.ticker === ticker);
    const missing = ['bull', 'bear'].filter(
      stance => !sides.some(c => c.call_type === stance && parsedAnalysis(c.raw_response) !== null)
    );
    const replayable = missing.filter(stance => toReplay.some(c => c.ticker === ticker && c.call_type === stance));
    if (missing.length !== replayable.length) {
      // A side with no stored call at all has no prompt to replay — the market context and the
      // day's move would have to be reconstructed, which this script deliberately does not do.
      throw new Error(`${ticker}: ${missing.join('/')} missing but only ${replayable.join('/') || 'none'} has a stored prompt to replay`);
    }
    console.log(`  ${ticker}: replaying ${replayable.join(', ')}`);
  }

  const results: { call: any; response: Anthropic.Message; costUsd: number; latencyMs: number }[] = [];
  for (const call of toReplay) {
    const startTime = performance.now();
    const { response, parsedOutput } = await parseWithRetry(
      client,
      {
        model: MODEL,
        max_tokens: REPLAY_MAX_TOKENS,
        system: call.system_prompt,
        thinking: THINKING,
        tools: TOOLS,
        output_config: { format: zodOutputFormat(stockAnalysisSchema) },
        messages: [{ role: 'user', content: call.user_prompt }],
      },
      { timeout: TIMEOUT }
    );
    const latencyMs = Math.round(performance.now() - startTime);
    const costUsd = calculateCallCost(MODEL, response.usage);
    results.push({ call, response, costUsd, latencyMs });

    console.log(`\n${call.ticker} ${call.call_type} — ${parsedOutput.conviction} conviction, ${latencyMs}ms, $${costUsd.toFixed(4)}, stop_reason ${response.stop_reason}`);
    console.log(`  ${parsedOutput.reasoning}`);
    for (const factor of parsedOutput.keyFactors) console.log(`  · ${factor}`);
  }

  const addedCost = results.reduce((n, r) => n + r.costUsd, 0);
  console.log(`\n${results.length} calls replayed, $${addedCost.toFixed(4)} added.`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Pass --apply to commit.');
    return;
  }

  for (const { call, response, costUsd, latencyMs } of results) {
    const { error: insertError } = await supabase.from('llm_calls').insert({
      run_id: run.id,
      call_type: call.call_type,
      ticker: call.ticker,
      model: MODEL,
      system_prompt: call.system_prompt,
      user_prompt: call.user_prompt,
      raw_response: response,
      usage: response.usage,
      cost_usd: costUsd,
      latency_ms: latencyMs,
    });
    if (insertError) throw new Error(`${call.ticker} ${call.call_type} insert failed: ${insertError.message}`);

    // Delete only after the replacement lands, so a failure here leaves a duplicate (visible,
    // fixable) rather than a hole (the ticker would show neither case).
    const { error: deleteError } = await supabase.from('llm_calls').delete().eq('id', call.id);
    if (deleteError) throw new Error(`${call.ticker} ${call.call_type} delete of failed row failed: ${deleteError.message}`);
  }

  const recovered = failedTickers.filter(ticker =>
    ['bull', 'bear'].every(
      stance =>
        results.some(r => r.call.ticker === ticker && r.call.call_type === stance) ||
        (run.llm_calls as any[]).some(
          c => c.ticker === ticker && c.call_type === stance && parsedAnalysis(c.raw_response) !== null
        )
    )
  );
  const rejectIds = (run.rejected_candidates as any[])
    .filter(r => r.reason === 'research_failed' && recovered.includes(r.ticker))
    .map(r => r.id);
  if (rejectIds.length > 0) {
    const { error: rejectError } = await supabase.from('rejected_candidates').delete().in('id', rejectIds);
    if (rejectError) throw new Error(`rejected_candidates delete failed: ${rejectError.message}`);
  }

  const totalCost = Number(run.total_cost_usd) + addedCost;
  const { error: runError } = await supabase
    .from('runs')
    .update({ total_cost_usd: totalCost.toFixed(6) })
    .eq('id', run.id);
  if (runError) throw new Error(`run cost update failed: ${runError.message}`);

  console.log(`\nWritten. Recovered ${recovered.join(', ')}; total_cost_usd now $${totalCost.toFixed(4)}.`);
  console.log('Judge not re-run — it still reflects the candidates it saw at the time.');
}

main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
