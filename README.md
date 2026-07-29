# Stock Dip Analyzer — Project Reference

A nightly AI agent that identifies the top 10 stocks that dropped significantly each day, researches why they dropped, and generates a risk report with buy/sell recommendations.

---

## The Core Idea

The investing strategy behind this tool: markets tend to overreact to negative events, creating buying opportunities for risk-tolerant investors. The agent finds these situations automatically every night.

---

## Architecture

### Why this is an Agent (not just a script)

A simple script would fetch stock data and return results. This system is agentic because Claude **dynamically decides what information to fetch** based on what it finds — the research path is not predetermined. You can't precompute all the reasons a stock might drop.

### The Two-Phase Pipeline

**Phase 1 — Deterministic (Workflow)**
Find the top 10 stocks. This is a fixed, sequential process:
1. Call Massive (Polygon.io) API for end-of-day data
2. Rank by volume-weighted drop metric (price drop % × volume ratio vs average)
3. Return top 10 candidates
4. Fetch global market context (macro conditions, sector trends) as shared context for all stocks

Currently run at `DIPS_LIMIT = 2` in `src/index.ts` (scaled down from the target of 10, mainly to keep per-run Claude/API cost down during early testing) — bump it back up once the pipeline's accuracy is validated via backtesting.

**Phase 2 — Agentic (Per stock, runs in parallel)**
For each candidate stock, two Claude calls run concurrently, each with Anthropic's built-in `web_search` tool (capped at one use per call) to decide for itself what to search for and pull in live information:
1. **Bull** call — builds the strongest case *for* buying, with a conviction rating
2. **Bear** call — builds the strongest case *against* buying, with a conviction rating

This is "agentic" in the sense that Claude — not host code — decides what to search for and how to weigh it, not in the sense of a multi-turn loop; today it's one tool-augmented call per stance, not an iterative read/search/re-evaluate cycle.

### The Bull/Bear/Judge Pattern

Rather than asking Claude "should I buy this?", each stock goes through three Claude calls:

- **Bull** — makes the strongest case *for* buying
- **Bear** — makes the strongest case *against* buying  
- **Judge** — reads both arguments and makes a final recommendation

This surfaces genuine uncertainty. If both arguments are strong, the judge says "proceed with caution" rather than giving false confidence.

### Delivery

- Runs nightly via a GitHub Actions cron (`.github/workflows/daily-run.yml`)
- Every run — market context, per-stock research, picks, rejected candidates, and raw LLM calls — is persisted to Supabase (`runs`, `llm_calls`, `picks`, `rejected_candidates` tables; see `supabase/schema.sql`)
- **Not yet built:** frontend with a date picker to review past days, and an email summary
- **In progress (V2):** feedback loop comparing past recommendations to actual stock performance over time — see Backtesting below

---

## Key Architectural Decisions & Tradeoffs

### Why end-of-day data (not real-time)?
- Stable, official closing prices and final volume numbers
- No streaming infrastructure needed
- Recommendations ready when you wake up
- Latency doesn't matter for a nightly job — Claude can be thorough

### Why tool use (not RAG, not fine-tuning)?
| Approach | What it's for | Why not used here |
|----------|--------------|-------------------|
| **Fine-tuning** | Changing model *behavior* and style | We need fresh knowledge, not behavior change |
| **RAG** | Searching your own private, managed data store | We don't own the data — it's live and external |
| **Tool use** | Fetching live, external information at runtime | ✅ This is what we need |

RAG would be appropriate if we added a feature to reference your personal trading history.

### Why parallelize the 10 stocks?
Each stock is independent. Running sequentially would be 10x slower with no benefit. Shared market context is fetched once upfront and passed to all parallel workers.

### Failure handling
- **Fault isolation** — each stock's research runs via `Promise.allSettled`, so one stock failing doesn't bring down the whole run; failures are logged to `rejected_candidates` and the rest of the run proceeds
- **Schema validation as the hallucination guardrail** — every Claude output (bull/bear analysis, judge picks) is parsed against a Zod schema (`zodOutputFormat`). Malformed or empty output throws instead of being silently persisted as a real recommendation
- **Not yet built:** automatic retry on validation failure (currently just fails that stock/run) and alerting — tracked in `BACKLOG.md`

### Agent bounds (preventing runaway cost/latency)
- **`max_tokens` ceiling** per call (4096 for bull/bear, 8096 for the judge) and a 180s request timeout
- **`web_search` capped at one use per call** — Claude gets a single search per bull/bear analysis, not an open-ended research budget
- **Not yet built:** confidence-based self-stopping and structured source-type limits — the current design is single-shot-per-stance rather than an iterative loop that would need those bounds

### Backtesting

Live `web_search` can't be restricted to a historical date, so any backtest that reuses it leaks future information. Two tracks handle this (`src/backtest/`):

1. **`pnpm backtest`** (`runBacktest.ts`) — swaps `web_search` for point-in-time Polygon news (filtered to `published_utc` on/before the historical date) so bull/bear research can't see the future, then runs the real, unmodified judge and scores picks against a buy-every-qualifying-dip baseline on actual forward returns. This validates the judge's decision logic only — Polygon news is much thinner than live search, so a good result here doesn't prove the deployed pipeline performs the same.
2. **`pnpm score-forward-test`** (`scoreForwardTest.ts`) — scores real production runs (logged by `logRun.ts` on every `pnpm start`) once enough time has passed for a forward return to exist. This is the only validation of the actual deployed pipeline, since live search results can't be replayed for past dates. Needs weeks of accumulated runs before it's meaningful.

See `BACKLOG.md` for current results and known gaps (e.g. no reasoning-quality grading yet, only outcome-based scoring).

---

## Project Dependencies

### Runtime

| Package | What it does | Why we need it |
|---------|-------------|----------------|
| `@anthropic-ai/sdk` | Official Anthropic SDK | Lets your TypeScript code talk to Claude via the API, including the `web_search` tool and structured output parsing |
| `@supabase/supabase-js` | Supabase client | Persists runs, LLM calls, picks, and rejected candidates |
| `axios` | HTTP client | Makes API requests to Massive (stock data) |
| `dotenv` | Loads `.env` files | Safely loads API keys into `process.env` without hardcoding them |
| `zod` | Schema validation | Validates Claude's structured output (`zodOutputFormat`) and Massive API responses, so malformed output fails loudly instead of persisting silently |

### Development only

| Package | What it does | Why we need it |
|---------|-------------|----------------|
| `typescript` | TypeScript compiler | Compiles `.ts` files to JavaScript that Node.js can run |
| `tsx` | Run TypeScript directly | Skip the manual compile step during development |
| `@types/node` | Node.js type definitions | Tells TypeScript what `process`, `fs`, `console` etc. are |

### Key concept: Why TypeScript doesn't come "out of the box"

Your computer natively runs JavaScript (via Node.js) and machine code. TypeScript must be compiled down to JavaScript first. The flow is:

```
your .ts file → TypeScript compiler → .js file → Node.js runs it
```

`tsx` combines the compile and run steps into one command during development.

---

## External APIs

| API | Purpose | Notes |
|-----|---------|-------|
| **Massive (Polygon.io)** | Stock price, volume, end-of-day data; historical news (backtest only) | Rebranded from Polygon.io in Oct 2025. Free tier sufficient |
| **Anthropic API** | Claude for reasoning and recommendations, plus the built-in `web_search` tool | Free credits on signup, pay-as-you-go after. `web_search` is Anthropic's server-side tool, not a separate news/Reddit API — Claude decides what to query |
| **Supabase** | Postgres database for run/pick/LLM-call persistence | Free tier sufficient |

---

## Project Setup

```bash
# Create project
mkdir stock-agent && cd stock-agent
pnpm init

# Install dependencies
pnpm add @anthropic-ai/sdk @supabase/supabase-js axios dotenv zod
pnpm add -D typescript tsx @types/node

# Initialize TypeScript
npx tsc --init
```

### Environment variables
Create a `.env` file (never commit this to git):
```
ANTHROPIC_API_KEY=your_key_here
MASSIVE_API_KEY=your_key_here
SUPABASE_URL=your_project_url
SUPABASE_SERVICE_KEY=your_service_role_key
```

Access in code:
```typescript
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.ANTHROPIC_API_KEY;
```