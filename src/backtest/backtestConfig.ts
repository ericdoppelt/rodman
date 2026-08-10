// Shared between runBacktest.ts (scoring) and warmCache.ts (cache warming), so a warmed cache
// always matches the candidate/horizon criteria the actual backtest run will ask for. Do not
// import these from runBacktest.ts directly — it runs main() as a side effect on import.

// Candidates per day. Bull/bear calls (2 per candidate) dominate run cost and time, so this is
// the main lever on both — raised from 2 now that the market-cap scan and Polygon calls generally
// are no longer the bottleneck (static snapshot + concurrent fetching, see staticMarketCap.ts and
// backtestStockAgents.ts).
export const DIPS_PER_DAY = 4;
// How many general market-news headlines to pull per test day for the market-context block.
export const MARKET_NEWS_LIMIT = 20;
// MIN_DOLLAR_VOLUME matches production's filter (see getLargestStockDips call in src/index.ts).
// MIN_MARKET_CAP is deliberately higher than production's $100M floor — testing whether the
// judge's edge holds on larger companies specifically. This means the candidate universe here is
// narrower than what the deployed pipeline actually sees; a result here doesn't say anything
// about the small/micro-cap dips production still picks from. $10B was tried first but true
// mega-caps rarely show up among the day's biggest percentage droppers, so the scan could exhaust
// the day's candidates without finding any. $2B is still meaningfully "larger companies" while
// staying common enough among daily droppers to find matches.
export const MIN_DOLLAR_VOLUME = 10_000_000;
export const MIN_MARKET_CAP = 2_000_000_000;
// Holding periods to score a pick against, listed chronologically. Primary metric is
// PRIMARY_HORIZON (5 days) — the bull/bear reasoning is anchored to a specific catalyst on a
// specific day, and that catalyst's relevance to price fades fast, so "a week" is closer to what
// the judge is actually reasoning about than "a month" or longer, where unrelated news has
// usually taken over as the main driver. 1-day is included to see whether the judge's edge is
// even stronger right next to the catalyst — additional context only, not primary (changing
// primary post-hoc based on which horizon looks best in a given run is exactly the p-hacking this
// backtest is designed to avoid). 21/42/63/... are monthly multiples (~21 trading days/month) out
// to 12 months, added to see how far the judge's edge persists/decays. All horizons are reported
// at no extra API cost, since getForwardReturns covers every horizon from one Polygon call — but
// the longest horizon here does push END_DATE_BUFFER_DAYS out, shrinking the testable window (see
// below), and any date already cached under a shorter HORIZONS list needs its forward returns
// backfilled (see dailyCache.ts's hasCompleteForwardReturns / warmCache.ts).
// Capped at 126 (~6 months) rather than 252 to keep every test date clean of training
// contamination. The judge and bull/bear models with the earliest training cutoffs still callable
// are Sonnet 4.5 and Haiku 4.5, both Jul 2025 (everything older — Sonnet 4, Opus 4, Opus 4.1 — is
// retired and returns an error), so test dates have to start 2025-08-01 to sit after it. A 252-day
// horizon needs dates ~366 calendar days old, which as of Aug 2026 leaves a clean-and-measurable
// overlap of six trading days. 126 days leaves ~111 candidate days instead. Revisit this: the
// clean window grows a day per day, so a 252-day run becomes viable around Nov 2026.
export const HORIZONS = [1, 5, 21, 42, 63, 84, 105, 126];
export const PRIMARY_HORIZON = 5;
// Most recent date considered, so the longest horizon's price history already exists. HORIZONS
// counts *trading* days, but this buffer is in *calendar* days, so a flat +10 badly undercounts
// weekends/holidays once horizons get large (252 trading days is ~353 calendar days, not 262) —
// use the same trading-day-to-calendar-day overshoot factor forwardReturn.ts uses for its own
// Polygon range query, plus the same safety margin.
export const END_DATE_BUFFER_DAYS = Math.ceil(Math.max(...HORIZONS) * 1.6) + 10;
// How far back candidate dates can be sampled from. A contiguous recent window is really one
// market regime — every test day shares whatever conditions happened to hold that stretch.
// Sampling randomly across a full year spreads days across different regimes (calm/volatile,
// up/down markets), so a good (or bad) result is harder to explain away as "just a good month."
//
// Held to 342 rather than 560 so the earliest sampleable date stays on or after 2025-09-01, past
// the Aug 2025 training data cutoff of Opus 4.6 — the strongest judge whose cutoff still leaves a
// usable window (Sonnet 4.5 and Haiku 4.5 are earlier at Jul 2025, everything newer is Jan 2026 or
// later, and everything older than 4.5 is retired). Sampling a date the judge was trained on lets
// it score against outcomes it may simply remember. Raise this to 373 if the judge is moved to a
// Jul 2025 model, and re-check it against the cutoff table whenever the judge changes.
//
// Because the window is relative to today, it drifts forward on its own — safe, since it only
// moves further past the cutoff, though it narrows the window over time.
export const LOOKBACK_WINDOW_DAYS = 342;
