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

create index if not exists idx_llm_calls_run_id on llm_calls(run_id);
create index if not exists idx_picks_run_id on picks(run_id);
create index if not exists idx_rejected_candidates_run_id on rejected_candidates(run_id);
