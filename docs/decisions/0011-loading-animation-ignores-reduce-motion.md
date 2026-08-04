# 0011: Loading-screen animation always plays, ignoring `prefers-reduced-motion`

## Context

The loading screen's pulse bars (`PulseLoader.tsx`) are a CSS keyframe animation — each bar dips
red and springs green in a left-to-right wave. iOS Safari maps Settings → Accessibility → Motion →
Reduce Motion to `prefers-reduced-motion: reduce`, which the app originally (and correctly, by the
standard reading of that media query) used to disable the animation entirely, leaving the bars
static and grey. Two other variants were tried and rejected: playing the wave once instead of
looping, and a static default with an explicit "show animation anyway" opt-in toggle.

## Options considered

1. **Respect `prefers-reduced-motion`, no animation at all.** The standard/conservative reading of
   the accessibility signal — most implementations turn motion off entirely rather than partially.
2. **Respect it, but play the wave once instead of looping.** A middle ground: some animation, but
   bounded rather than perpetual. Not standard guidance, just a judgment call — and asserted as
   fact without being flagged as a trade-off, which was a mistake.
3. **Default to static, but add a per-browser opt-in toggle to preview the real animation** (a
   `localStorage`-backed "Show animation anyway" button, shown only when reduced motion is
   detected). Preserves the accessibility default for everyone while still letting one person see
   the real thing on request.
4. **Ignore `prefers-reduced-motion` entirely — always play the full looping animation.**

## Decision

Went with option 4, per explicit instruction: the loading animation should never change based on
this setting. `PulseLoader.tsx` and `index.css` have no reduced-motion branching for `.pulse-bar`
at all — every visitor sees the same animation regardless of their OS/browser setting.

## Trade-off

This is a real accessibility regression for anyone who has Reduce Motion on for a genuine
vestibular/motion-sensitivity reason, not just battery-saving — they'll see the full height/color
animation on every page load with no way to opt out short of leaving the site. Accepted knowingly:
this is a small personal project with an audience of one, and the animation is confined to a
32px-tall region during a ~2s loading state, not a persistent or page-wide effect.
