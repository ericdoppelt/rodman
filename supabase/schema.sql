-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  params jsonb not null,
  git_sha text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error text,
  total_cost_usd numeric(10, 6),
  -- Judge's stated reason for making no pick (judgeOutputSchema.noPickReason). Null when a
  -- pick was made, or when the run predates the field.
  no_pick_reason text,
  -- Non-null means the reason was reconstructed later by replaying the stored judge prompt,
  -- not recorded during the run. The UI labels these so a reconstruction is never mistaken
  -- for what the judge actually said that day.
  no_pick_reason_backfilled_at timestamptz,
  -- Non-null means the run was completed by replaying stored research after the original run
  -- failed (see scripts/reconstructRun.ts). `error` stays populated as the original record.
  reconstructed_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists llm_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  call_type text not null check (call_type in ('market_context', 'bull', 'bear', 'judge')),
  ticker text,
  model text not null,
  system_prompt text not null,
  user_prompt text not null,
  raw_response jsonb not null,
  usage jsonb not null,
  cost_usd numeric(10, 6) not null,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  ticker text not null,
  reasoning text not null,
  entry_price numeric(12, 4),
  -- Non-null means this pick was reconstructed after the fact from stored research. It was
  -- never traded, and must be excluded from win rate and return stats.
  reconstructed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists rejected_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  ticker text not null,
  reason text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists pick_price_series (
  pick_id uuid primary key references picks(id) on delete cascade,
  series jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per attempted Alpaca paper order (success or failure) for a pick.
-- See docs/decisions/0012-alpaca-paper-trading-execution.md.
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references picks(id) on delete cascade,
  symbol text not null,
  notional_usd numeric(10, 2) not null,
  alpaca_order_id text,
  status text not null,
  filled_qty numeric(18, 8),
  filled_avg_price numeric(12, 4),
  error text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_calls_run_id on llm_calls(run_id);
create index if not exists idx_picks_run_id on picks(run_id);
create index if not exists idx_rejected_candidates_run_id on rejected_candidates(run_id);
create index if not exists idx_trades_pick_id on trades(pick_id);

-- RLS: service_role (cron/pipeline) bypasses RLS entirely. These policies only govern
-- anon/authenticated access, i.e. the client-facing web UI reading with the anon key.
alter table runs enable row level security;
alter table llm_calls enable row level security;
alter table picks enable row level security;
alter table rejected_candidates enable row level security;
alter table pick_price_series enable row level security;
alter table trades enable row level security;
-- No anon/authenticated policy for trades — internal execution detail, not surfaced in the
-- public web UI (paper trading only for now).

-- Public read access: only completed runs and their picks. 'running'/'failed' rows (which
-- can carry internal error text) stay hidden, and llm_calls/rejected_candidates have no
-- policy at all, so anon/authenticated get zero access to them.
create policy "public can read completed runs"
  on runs for select
  to anon, authenticated
  using (status = 'completed');

-- RLS is row-level: admitting a row admits every column in it. `error` can carry internal
-- detail (stack traces, request IDs), and reconstructing a failed run flips its status to
-- 'completed' — which would otherwise expose exactly what hiding failed runs was protecting.
-- Column grants are the second layer. A column-level REVOKE is inert while the role holds
-- table-level SELECT, so the table-wide grant is dropped and re-granted per column.
--
-- MAINTENANCE: a column added to `runs` later is NOT public until listed here. That is
-- deliberate — new columns default to private rather than silently becoming world-readable.
revoke select on runs from anon, authenticated;
grant select (
  id,
  run_date,
  params,
  git_sha,
  status,
  total_cost_usd,
  no_pick_reason,
  no_pick_reason_backfilled_at,
  reconstructed_at,
  created_at,
  completed_at
) on runs to anon, authenticated;

create policy "public can read picks for completed runs"
  on picks for select
  to anon, authenticated
  using (
    exists (
      select 1 from runs
      where runs.id = picks.run_id
      and runs.status = 'completed'
    )
  );

create policy "public can read price series for completed runs"
  on pick_price_series for select
  to anon, authenticated
  using (
    exists (
      select 1 from picks
      join runs on runs.id = picks.run_id
      where picks.id = pick_price_series.pick_id
      and runs.status = 'completed'
    )
  );

-- Exposes the research process (market context, bull/bear cases, judge call) and
-- pre-research rejections for the per-run "how this pick was made" flow view.
-- See docs/decisions/0010-expose-llm-calls-and-rejects-via-rls.md.
create policy "public can read llm calls for completed runs"
  on llm_calls for select
  to anon, authenticated
  using (
    exists (
      select 1 from runs
      where runs.id = llm_calls.run_id
      and runs.status = 'completed'
    )
  );

create policy "public can read rejected candidates for completed runs"
  on rejected_candidates for select
  to anon, authenticated
  using (
    exists (
      select 1 from runs
      where runs.id = rejected_candidates.run_id
      and runs.status = 'completed'
    )
  );
