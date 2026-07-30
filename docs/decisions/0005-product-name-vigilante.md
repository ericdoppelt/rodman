# 0005: Rename the client UI's brand to "Vigilante"

## Context

The original welcome animation was a full-viewport splash: a stock line crashing
then rebounding, then lifting away to reveal the dashboard. It worked, but was
judged too dramatic for a repeat visitor — the ask was for something that "just
shows up in the top left like signing a name," i.e. a small, persistent logo
mark rather than a takeover.

That reframing raised a follow-on idea: instead of animating an arbitrary
zigzag, draw a *letter* — so the brand mark and the crash/rebound motif are the
same stroke. That only works if a letter in the product's name can be drawn as
one continuous line and still read unambiguously as that letter.

## Options considered

**Letter shape** — which letters survive being drawn as a single jagged/curved
price line and still read as themselves:
- **V** — the shape *is* crash-then-rebound, no reinterpretation needed. Best fit.
- **W** — two V's; maps to the real "W-shaped recovery" term and a harder-won
  redemption arc (dip, false rebound, dip again, then the real recovery).
- **U** — works, but reads as a soft trough, not a crash. Less dramatic.
- Other letters (S, N, K, Z, ...) need enough stylization that they risk not
  reading as that letter at all.

**Name, once V was picked as the letter** — dozens of "V" words were considered
across a few angles (edge/perspective: Vantage, Vista; direction/momentum:
Vector, Veer; watchfulness: Vigil, Vigilant; redemption/renewal: Vernal,
Vitality, Vaunt; literal market terms: Volatile/Volatility). "Vigilante" won
out via wordplay: a vigilante *breaks* the law, and a stock *breaks* out or
down — "breakout" and "breakdown" are real technical-analysis terms, so the
pun lands on more than just sound.

## Decision

Renamed the client-facing brand (page title, hero wordmark) from "Stock Agent"
to **Vigilante**. The hero now pairs a small self-drawing "V" mark (same
red→green crash/rebound gradient and stroke-draw technique as a pick's price
line, see `docs/decisions/0002-client-ui-and-rls-scope.md` for the stack this
sits in) with the "Vigilante" wordmark next to it — see
`web/src/components/VigilanteMark.tsx`. The full-screen splash
(`IntroSplash.tsx`) was removed entirely in favor of this.

Scope: this renames the **web UI's displayed brand only** — page `<title>`,
hero heading, and the new logo mark. It does not rename the repository,
`package.json`, backend code, or docs outside this decision.

## Trade-off

"Vigilante" drops the literal word "stock" from the name, and carries a real
connotation (breaking the law, acting outside the system) that isn't smoothed
over — it's leaned into on purpose via the breakout/breakdown wordplay. In
exchange: a distinctive, memorable brand, and a logo mark that is the crash/
rebound shape rather than a decoration next to it.
