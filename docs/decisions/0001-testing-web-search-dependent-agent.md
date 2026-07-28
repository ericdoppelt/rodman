# 0001: Testing an agent that depends on live web search

## Context
`fetchMarketContext.ts` and `stockAgents.ts` call Claude with the `web_search_20250305`
tool. That tool always queries the live web — there's no free way to mock or replay it,
and no way to pin it to a past date. That makes normal backtesting impossible: rerunning
the pipeline against "a week ago" doesn't return what the web looked like a week ago, it
returns whatever is on the web today.

## Options considered
- **Record/replay live web_search responses** — rejected, no affordable way to capture
  and pin historical search results for a given date.
- **Live-only testing (no mock)** — rejected as the sole strategy: too slow/expensive to
  run every iteration during development, and non-deterministic runs are hard to debug.
- **Simulated lookup tool + forward test** — chosen (see below).

## Decision
Two-tier approach:
1. **Simulated tool for fast iteration.** Build a stand-in lookup tool that returns
   canned/simplified data instead of real web search, so the agent logic (prompting,
   parsing, control flow) can be tested quickly and deterministically. Treated as lower
   trust — it validates plumbing, not real-world accuracy.
2. **Forward test for ground truth.** Run the real pipeline daily, record what it would
   have picked, and later compare those picks against actual outcomes. This is the only
   source of truth on whether the agent's decisions are actually good.

## Trade-off
The simulated tool is cheap and fast but its results can't be fully trusted — it may not
reflect how the real web_search tool behaves, so passing tests there doesn't guarantee
correctness. The forward test gives real signal but is slow (one data point per day) and
can't be used for tight development iteration.
