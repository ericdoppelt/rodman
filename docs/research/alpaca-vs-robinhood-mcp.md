# Alpaca vs. Robinhood MCP for automated trade execution

Research note, not a decision — no broker has been chosen or wired up yet.

## Robinhood MCP

- Official Robinhood endpoint (`https://agent.robinhood.com/mcp/trading`), launched May 2026. Lets an AI agent read a dedicated, separately-funded "agentic" sub-account and place trades there; your main Robinhood account stays read-only.
- Auth is OAuth, and setup/authentication is **desktop-browser-interactive only** — no documented service-account or API-key path. Not usable from a non-interactive environment like GitHub Actions without a human in the loop.
- Robinhood explicitly disclaims responsibility for agent behavior once connected ("the safety is on you"); guardrails are advisory, not enforced.
- No documented rate limits.

## Alpaca

- Commission-free, API-first US broker built for algo trading. Auth is a plain API key/secret — no browser OAuth step — so it works fine from headless environments (GitHub Actions, cron, always-on scripts).
- Free **paper trading** mode: simulated account (fake ~$100k balance), no card, no funding, no connection to a real bank account. Good for testing this pipeline's execution logic before any real money is involved.
- Going live is a separate step: real brokerage account funded via ACH.
- No trading commissions for retail users. Alpaca makes money via payment for order flow, interest on cash/margin balances, and enterprise API fees — not per-trade fees.
- Key-leak blast radius: a stolen live key lets someone place/cancel trades in the account, but not withdraw to an external bank (withdrawals need separate verified banking auth). Mitigate with minimally-scoped keys, expiration, rotation, and never committing keys to the repo (use GitHub Actions encrypted secrets).

## Takeaway

For this project's use case — a GitHub Actions cron running unattended — Robinhood MCP doesn't fit today because it can't authenticate headlessly. Alpaca does fit, and its free paper-trading tier lets execution logic be built and tested with zero cost/risk before touching real money. See `BACKLOG.md` for the deferred execution-integration item.
