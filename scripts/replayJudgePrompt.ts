/**
 * Measure what a judge-prompt change does to the pick rate, without re-running research.
 *
 * Every completed run stores its judge call: the exact user prompt (all ten bull/bear pairs as
 * the judge saw them) and the exact system prompt in force that day. So a prompt change can be
 * A/B'd on real history for the cost of judge calls alone — no web searches, no Haiku research,
 * ~$0.12 per call. The stored user prompt is replayed verbatim; only `system` differs between
 * arms.
 *
 * Two things this CANNOT measure, and neither should be inferred from its output:
 *   - Changes to the bull/bear prompts. Those alter the research text itself, which is frozen in
 *     the stored user prompt. Testing those means re-running research (~$0.90 per day).
 *   - A single day's verdict. Replays are not deterministic — a 2026-08-11 replay once picked a
 *     stock the original declined, on an unchanged prompt. Read the pick RATE across reps, not
 *     any one line.
 *
 * Writes nothing: no DB rows, no Alpaca orders. Read-only against Supabase.
 *
 * Usage: pnpm exec tsx scripts/replayJudgePrompt.ts --dates 2026-08-11,2026-08-12 [--reps 2] [--arms both|new]
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/db/supabaseClient.js';
import { judgeOutputSchema } from '../src/schemas.js';
import { JUDGE_SYSTEM_PROMPT, MODEL, MAX_TOKENS } from '../src/judgeResearch.js';
import { parseWithRetry } from '../src/parseWithRetry.js';
import { calculateCallCost } from '../src/usageTracker.js';

dotenv.config();

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`pass --${name}`);
    return fallback;
  }
  return value;
}

const DATES = arg('dates').split(',').map(d => d.trim()).filter(Boolean);
const REPS = Number(arg('reps', '2'));
const ARMS = arg('arms', 'both') === 'new' ? ['new'] as const : ['old', 'new'] as const;

type Verdict = { arm: string; date: string; rep: number; ticker: string | null; text: string; costUsd: number };

async function judgeOnce(client: Anthropic, system: string, userPrompt: string): Promise<{ ticker: string | null; text: string; costUsd: number }> {
  const { response, parsedOutput } = await parseWithRetry(client, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    output_config: { format: zodOutputFormat(judgeOutputSchema) },
    messages: [{ role: 'user', content: userPrompt }],
  }, { timeout: 180_000 });
  const pick = parsedOutput.picks[0];
  return {
    ticker: pick?.ticker ?? null,
    text: pick ? pick.reasoning : (parsedOutput.noPickReason ?? ''),
    costUsd: calculateCallCost(MODEL, response.usage),
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const supabase = createSupabaseClient();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data, error } = await supabase
    .from('runs')
    .select('run_date, picks(ticker), llm_calls(call_type, system_prompt, user_prompt)')
    .in('run_date', DATES);
  if (error) throw new Error(error.message);

  const days = (data ?? []).map((run: any) => {
    const judge = (run.llm_calls ?? []).filter((c: any) => c.call_type === 'judge').at(-1);
    return { date: run.run_date, judge, originalPick: run.picks?.[0]?.ticker ?? null };
  }).filter(d => d.judge);
  if (days.length === 0) throw new Error('no stored judge calls for those dates');

  const planned = days.length * REPS * ARMS.length;
  console.log(`${days.length} day(s) x ${REPS} rep(s) x ${ARMS.length} arm(s) = ${planned} judge calls, ~$${(planned * 0.12).toFixed(2)}\n`);

  const verdicts: Verdict[] = [];
  for (const day of days) {
    for (const arm of ARMS) {
      // The "old" arm replays the system prompt exactly as recorded that day, so both arms are
      // fresh draws on the same inputs — comparing a replay against the single live verdict
      // would confound the prompt change with replay non-determinism.
      const system = arm === 'old' ? day.judge.system_prompt : JUDGE_SYSTEM_PROMPT;
      for (let rep = 1; rep <= REPS; rep++) {
        const result = await judgeOnce(client, system, day.judge.user_prompt);
        verdicts.push({ arm, date: day.date, rep, ...result });
        console.log(`${day.date} ${arm.padEnd(3)} rep${rep}: ${result.ticker ? `PICK ${result.ticker}` : 'no pick'}  ($${result.costUsd.toFixed(4)})`);
      }
    }
  }

  console.log('\n--- pick rate ---');
  for (const arm of ARMS) {
    const rows = verdicts.filter(v => v.arm === arm);
    const picks = rows.filter(v => v.ticker);
    console.log(`${arm.padEnd(3)}: ${picks.length}/${rows.length} picked${picks.length ? ` (${[...new Set(picks.map(p => `${p.date} ${p.ticker}`))].join(', ')})` : ''}`);
  }
  console.log(`\ntotal spend: $${verdicts.reduce((sum, v) => sum + v.costUsd, 0).toFixed(4)}`);
  console.log('Nothing was written to Supabase or Alpaca.');
}

main().catch(err => { console.error(err); process.exit(1); });
