# 0002: Client-facing UI stack and RLS data scope

## Context

RLS was disabled on all four Supabase tables (`runs`, `llm_calls`, `picks`, `rejected_candidates`) — fine while only the `service_role` key (server-side cron) touched them, but unsafe once a client-facing UI reads with the `anon` key. Enabling RLS forces two decisions: what data the public UI is allowed to see, and what stack the UI itself is built with.

## Decision 1: Data scope

**Options considered:**
- Runs + picks only — final picks and judge reasoning, nothing else.
- Runs + picks + rejected candidates — adds visibility into what was considered and passed on.
- Everything, including `llm_calls` — full transparency into bull/bear/judge raw responses, prompts, and per-call cost.

**Decision:** Runs + picks only. `llm_calls` (system prompts, user prompts, raw model responses, per-call cost) and `rejected_candidates` stay fully locked out via RLS (enabled, no policy) — no reason to expose prompt engineering internals or cost data publicly, and rejected-candidate funnel data isn't relevant to an end user.

Within `runs`/`picks`, public read access is further scoped to `status = 'completed'` runs only — `running`/`failed` rows can carry internal error text (`runs.error`) not meant for public display.

**Trade-off:** If reasoning-transparency or funnel visibility becomes a feature ask later, this requires a new policy addition (low cost) rather than a code change.

## Decision 2: Stack

**Options considered:**
- Vite + React SPA on Vercel — static build, Supabase JS client reads directly with the anon key (RLS-protected).
- Next.js on Vercel — heavier framework, SSR/routing conventions.
- Single static HTML file, no build step, Supabase client via CDN.

**Decision:** Vite + React SPA on Vercel. No server-side logic or SEO need today; Next.js would be unused weight. A no-build HTML file was considered but React gives room to grow (routing, components) without a rewrite.

**Trade-off:** Static SPA means all data access is client-side against Supabase directly — fine as long as RLS is the only access-control boundary needed (true today; would need to change if auth/personalization is ever added).
