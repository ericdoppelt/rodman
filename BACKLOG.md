# Backlog

## Open items

- **Verify bull/bear web_search allocation isn't redundant with market context.** Each bull/bear call in `stockAgents.ts` gets one `web_search` (`max_uses: 1`), steered by prompt toward ticker-specific news ("Research `{ticker}` specifically"). But this is a soft instruction, not enforced — if the model's single query ends up broad (re-deriving general market conditions already passed in as text) instead of ticker-specific, that search is wasted. Check by logging the actual query from the `web_search_tool_result` / `server_tool_use` blocks in `response.content` (currently discarded — only `parsed_output` is read) across a few runs to see what's actually being searched.

- **No backtesting/eval loop validating pick quality.** Nothing currently checks whether "strong conviction" picks from `pickStock` actually outperform a baseline (e.g., buying every qualifying dip unconditionally, or a random pick among candidates). Without this, there's no evidence the LLM filter adds value over noise.

- **Stale signal timing.** `index.ts` computes `yesterday` as 3 days ago (`yesterday.setDate(yesterday.getDate() - 3)`), so buy signals are generated for a single-day price move that happened 3 days prior. Any overreaction-correction dynamic would likely have already played out by the time a trade could be made. Worth deciding if this is intentional (e.g., data availability lag) or should be tightened.

- **`minVolume` filters on shares, not dollars.** `getLargestStockDips(yesterday, 2, 100000)` — 100,000 is a share-count floor, not a dollar-volume floor, so it doesn't actually filter out illiquid low-price stocks. Consider filtering on dollar volume (`volume * close`) instead.

- **No position sizing / risk management.** The pipeline recommends a bare ticker with no sizing, stop-loss, or portfolio-level risk logic.

- **Build a backtest/eval harness.** Label historical dips by objective forward return, run the pipeline against them, score precision on "picks" vs. baseline (buy every qualifying dip). Watch for leakage — `web_search` returns live info, not what was known on the historical date. Doubles as a regression test for future prompt/model changes.

- **Add few-shot examples for conviction calibration** (depends on backtest harness above). Once real graded cases exist, use them as few-shot examples to calibrate what "strong" vs "weak" conviction should look like. Risk: examples can bias toward the example's pattern (sector, evidence type) rather than per-case judgment — keep examples diverse.

- **Use XML tags to structure prompt context.** Bull/bear/judge prompts currently interpolate context (market conditions, stock data) as flat text. Wrapping distinct sections in XML tags (e.g. `<market_context>`, `<stock_data>`) is Anthropic's recommended pattern for helping the model reliably distinguish different kinds of input.

- **Add a custom tool** (e.g. execute/log a trade, record a pick to a database). Currently only the server-side `web_search` tool is used, so there's no client-executed tool input to validate. Use `strict: true` on the tool definition to guarantee `tool_use.input` matches its schema, and Zod to type/parse it on the way in.
