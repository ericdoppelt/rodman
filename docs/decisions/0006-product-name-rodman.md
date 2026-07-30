# 0006: Rename the client UI's brand to "Rodman"

## Context

`0005` renamed the client UI to "Vigilante" specifically because "V" could be
drawn as the crash/rebound line and serve as the first letter of the wordmark.
"Rodman" was proposed as a replacement — Dennis Rodman, the best rebounder in
NBA history, is a much more direct hit on the "buy the dip, it rebounds"
thesis than the "breakout/breakdown" wordplay "Vigilante" relied on.

The catch: "Rodman" doesn't start with V (or any letter that reads cleanly as
a single crash/rebound stroke, per the letter survey in `0005`), so the mark
can no longer literally *be* the first letter of the name.

## Options considered

- **Standalone V-shaped icon beside the wordmark** — revert to an icon +
  text lockup (the pre-0005 letter-integration approach), dropping the
  letter pun but keeping the V shape as-is.
- **Jersey-number badge** — drop the price-line shape entirely in favor of a
  bold number mark (91, 10, 70/73 — Rodman's numbers across teams), leaning
  fully into the person over the chart motif.
- **Crash/rebound line as an underline accent** — keep "Rodman" as plain
  text and place the red→green line underneath it as a flourish, rather than
  forming a letter.

## Decision

Went with the **underline accent**. "Rodman" renders as plain wordmark text
(`web/src/App.tsx`, `.hero h1` in `web/src/index.css`); the crash/rebound
line now lives in `web/src/components/RebounderSwoosh.tsx`, drawn once on
load beneath the word instead of replacing a letter in it. Same drawing
technique and gradient-crosses-at-the-low-point rule as the price-line charts
and the previous "V" mark.

The favicon (`web/public/favicon.svg`) is unchanged — it was always an
abstract V-shaped mark, never a literal spelling of the product name, so it
still works as the app's icon regardless of what the wordmark says.

Scope: as with `0005`, this renames the **web UI's displayed brand only** —
page `<title>` and hero wordmark. Repository name, `package.json`, and
backend code are untouched.

## Trade-off

Loses the "the logo mark literally is a letter in the name" trick that
motivated `0005` in the first place — the underline is a decoration next to
the word now, not part of the word. In exchange: a name that hits the
product's actual thesis (buying dips that rebound) directly, instead of via
wordplay on "breaking."
