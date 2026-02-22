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

**Phase 2 — Agentic (Per stock, runs in parallel)**
For each of the 10 stocks, Claude runs a research loop:
1. Reads initial price/volume data
2. Decides what to look up (news articles, earnings data, Reddit sentiment, etc.)
3. Calls tools to fetch that information
4. Evaluates whether it has enough to make a recommendation
5. Stops when confident (confidence-based termination) or hits a token budget (hard ceiling)

### The Bull/Bear/Judge Pattern

Rather than asking Claude "should I buy this?", each stock goes through three Claude calls:

- **Bull** — makes the strongest case *for* buying
- **Bear** — makes the strongest case *against* buying  
- **Judge** — reads both arguments and makes a final recommendation

This surfaces genuine uncertainty. If both arguments are strong, the judge says "proceed with caution" rather than giving false confidence.

### Delivery

- Results stored in a database, indexed by date
- Frontend with a date picker to review any past day
- Optional morning email summary
- **V2:** Feedback loop comparing past recommendations to actual stock performance over time — this is how you evaluate whether the agent is actually good at its job

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
- **Fault isolation** — one stock failing doesn't bring down the whole run
- **Retry once** automatically on failure
- **Alert** if retry also fails
- **Agent output validation** — Claude's output is also a failure mode (hallucination, malformed JSON)

### Agent bounds (preventing runaway cost/latency)
- **Token budget** — hard ceiling on context consumed per stock
- **Confidence-based stopping** — Claude self-assesses whether to keep researching
- **Source type limits** — structured categories of sources to consult

---

## Project Dependencies

### Runtime

| Package | What it does | Why we need it |
|---------|-------------|----------------|
| `@anthropic-ai/sdk` | Official Anthropic SDK | Lets your TypeScript code talk to Claude via the API |
| `axios` | HTTP client | Makes API requests to Massive (stock data) and news APIs |
| `dotenv` | Loads `.env` files | Safely loads API keys into `process.env` without hardcoding them |

### Development only

| Package | What it does | Why we need it |
|---------|-------------|----------------|
| `typescript` | TypeScript compiler | Compiles `.ts` files to JavaScript that Node.js can run |
| `ts-node` | Run TypeScript directly | Skip the manual compile step during development |
| `@types/node` | Node.js type definitions | Tells TypeScript what `process`, `fs`, `console` etc. are |

### Key concept: Why TypeScript doesn't come "out of the box"

Your computer natively runs JavaScript (via Node.js) and machine code. TypeScript must be compiled down to JavaScript first. The flow is:

```
your .ts file → TypeScript compiler → .js file → Node.js runs it
```

`ts-node` combines the compile and run steps into one command during development.

---

## External APIs

| API | Purpose | Notes |
|-----|---------|-------|
| **Massive (Polygon.io)** | Stock price, volume, end-of-day data | Rebranded from Polygon.io in Oct 2025. Free tier sufficient |
| **NewsAPI / Massive News** | Fetch articles about why a stock dropped | Claude decides when to call this |
| **Reddit API** | Organic sentiment from r/investing etc. | Free, no key needed for basic read access |
| **Anthropic API** | Claude for reasoning and recommendations | Free credits on signup, pay-as-you-go after |

---

## Project Setup

```bash
# Create project
mkdir stock-agent && cd stock-agent
pnpm init

# Install dependencies
pnpm add @anthropic-ai/sdk axios dotenv
pnpm add -D typescript ts-node @types/node

# Initialize TypeScript
npx tsc --init
```

### Environment variables
Create a `.env` file (never commit this to git):
```
ANTHROPIC_API_KEY=your_key_here
MASSIVE_API_KEY=your_key_here
```

Access in code:
```typescript
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.ANTHROPIC_API_KEY;
```