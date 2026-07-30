-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  params jsonb not null,
  git_sha text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error text,
  total_cost_usd numeric(10, 6),
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

create index if not exists idx_llm_calls_run_id on llm_calls(run_id);
create index if not exists idx_picks_run_id on picks(run_id);
create index if not exists idx_rejected_candidates_run_id on rejected_candidates(run_id);

-- RLS: service_role (cron/pipeline) bypasses RLS entirely. These policies only govern
-- anon/authenticated access, i.e. the client-facing web UI reading with the anon key.
alter table runs enable row level security;
alter table llm_calls enable row level security;
alter table picks enable row level security;
alter table rejected_candidates enable row level security;
alter table pick_price_series enable row level security;

-- Public read access: only completed runs and their picks. 'running'/'failed' rows (which
-- can carry internal error text) stay hidden, and llm_calls/rejected_candidates have no
-- policy at all, so anon/authenticated get zero access to them.
create policy "public can read completed runs"
  on runs for select
  to anon, authenticated
  using (status = 'completed');

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
