/**
 * One-off: reconstruct `runs.no_pick_reason` for runs that predate the field.
 *
 * Runs before 2026-08-13 stored `[]` and nothing else when the judge declined, so those days
 * show a generic UI fallback instead of a reason. This replays each such run's stored judge
 * prompt through the current `judgeOutputSchema`, which requires a reason when picks is empty.
 *
 * The result is a RECONSTRUCTION, not what the judge said at the time. It is written to
 * `no_pick_reason` with `no_pick_reason_backfilled_at` set so the UI can label it, and the
 * original `llm_calls` row is never touched — that table stays a true log of calls that
 * actually happened.
 *
 * It asks for an EXPLANATION of the decline that actually happened, rather than re-judging.
 * Re-judging was tried first and is the wrong tool: replays are not deterministic, so a
 * 2026-08-11 replay picked a stock the original declined, and there was then no decline left
 * to explain. Conditioning on the recorded outcome keeps every reason consistent with history.
 *
 * Guards:
 *   1. The judge has no tools, so no new evidence enters; the user prompt is the stored one.
 *   2. An as-of instruction pins the model to the run date.
 *   3. The text is scanned for later dates and hindsight phrasing, and skipped if hit.
 *
 * (Hindsight is unlikely for these dates — they postdate the model's training cutoff — but the
 * scan is cheap and would catch a future backfill of older runs, where it would matter.)
 *
 * Usage: pnpm exec tsx scripts/backfillNoPickReason.ts [--apply]
 * Without --apply it is a dry run and writes nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import dotenv from 'dotenv';
import { createSupabaseClient } from '../src/db/supabaseClient.js';
import { judgeOutputSchema } from '../src/schemas.js';
import { MODEL, MAX_TOKENS } from '../src/judgeResearch.js';
import { parseWithRetry } from '../src/parseWithRetry.js';
import { calculateCallCost } from '../src/usageTracker.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const EXPLAIN_SYSTEM_PROMPT = (runDate: string) => `You are a decisive senior investment analyst reviewing a set of stocks that dropped significantly on ${runDate}.

On that day, after weighing the bull and bear cases below, the decision was to recommend NO stock. That decision is settled and is not yours to revisit. Your task is to articulate why it was the right call.

Rules:
- Return an empty picks array. You are explaining a decline, not making a pick.
- Set noPickReason: 2-3 sentences on what specifically fell short. Name the tickers that came closest and what would have had to be different about the evidence to justify buying them.
- Ground every claim in the bull and bear cases provided. They are the entirety of the evidence.
- Do not restate the decision rules, and do not say merely that conviction was insufficient.

POINT-IN-TIME CONSTRAINT
- Use no knowledge of what happened to any of these stocks after ${runDate} — no later prices, earnings, news, or outcomes.
- Do not mention any date after ${runDate}.
- Do not use hindsight framing ("went on to", "subsequently", "as it turned out", "in hindsight", "we now know").
Write as someone who does not know the future, because on ${runDate} nobody did.`;

/** Phrases and dates that would betray post-hoc knowledge. */
function findHindsight(text: string, runDate: string): string[] {
  const hits: string[] = [];

  for (const phrase of ['went on to', 'subsequently', 'as it turned out', 'in hindsight', 'we now know', 'has since', 'later rose', 'later fell', 'ended up']) {
    if (text.toLowerCase().includes(phrase)) hits.push(`phrase: "${phrase}"`);
  }

  const runTime = new Date(`${runDate}T00:00:00Z`).getTime();
  // ISO dates and "August 14, 2026" style, anywhere in the text.
  const patterns = [/\d{4}-\d{2}-\d{2}/g, /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/g];
  for (const pattern of patterns) {
    for (const match of text.match(pattern) ?? []) {
      const t = new Date(match.replace(/,/, '')).getTime();
      if (!Number.isNaN(t) && t > runTime) hits.push(`date after run: "${match}"`);
    }
  }

  return hits;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const supabase = createSupabaseClient();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .select('id, run_date, picks(id), llm_calls(call_type, user_prompt)')
    .eq('status', 'completed')
    .is('no_pick_reason', null)
    .order('run_date', { ascending: true });
  if (runsError) throw new Error(runsError.message);

  const targets = (runs ?? [])
    .filter((r: any) => r.picks.length === 0)
    .map((r: any) => ({ id: r.id, runDate: r.run_date, userPrompt: r.llm_calls.find((c: any) => c.call_type === 'judge')?.user_prompt }))
    .filter(r => {
      if (!r.userPrompt) console.log(`${r.runDate}: SKIP — no stored judge prompt`);
      return !!r.userPrompt;
    });

  console.log(`${targets.length} no-pick run(s) to reconstruct${APPLY ? '' : '  (DRY RUN — pass --apply to write)'}\n`);

  let spend = 0;
  for (const target of targets) {
    const system = EXPLAIN_SYSTEM_PROMPT(target.runDate);

    const { response, parsedOutput } = await parseWithRetry(client, {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      output_config: { format: zodOutputFormat(judgeOutputSchema) },
      messages: [{ role: 'user', content: target.userPrompt! }],
    }, { timeout: 180_000 });
    spend += calculateCallCost(MODEL, response.usage);

    if (parsedOutput.picks.length > 0) {
      console.log(`${target.runDate}: SKIP — asked to explain a decline but returned ${parsedOutput.picks.map(p => p.ticker).join(', ')}`);
      continue;
    }

    const reason = parsedOutput.noPickReason!;
    const hindsight = findHindsight(reason, target.runDate);
    if (hindsight.length > 0) {
      console.log(`${target.runDate}: SKIP — hindsight detected (${hindsight.join('; ')})\n   ${reason}`);
      continue;
    }

    console.log(`${target.runDate}: ${reason}\n`);

    if (APPLY) {
      const { error } = await supabase
        .from('runs')
        .update({ no_pick_reason: reason, no_pick_reason_backfilled_at: new Date().toISOString() })
        .eq('id', target.id);
      if (error) throw new Error(`write failed for ${target.runDate}: ${error.message}`);
    }
  }

  console.log(`Spend: $${spend.toFixed(4)}${APPLY ? '' : '  (nothing written)'}`);
}

main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
