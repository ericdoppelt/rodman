// A tiny live ticker: four neighboring bars idle with a gentle ambient bob,
// while the center bar is the "hero" — it dips red, springs green past its
// resting height, then settles back to grey and holds (dormant) before the
// next beat. Reads as a chart, not a chart's clip-art.
export function PulseLoader() {
  return (
    <div className="pulse-loader" aria-label="Loading picks" role="status">
      <div className="pulse-bars">
        <span className="pulse-bar pulse-bar--b1" />
        <span className="pulse-bar pulse-bar--b2" />
        <span className="pulse-bar pulse-bar--hero" />
        <span className="pulse-bar pulse-bar--b4" />
        <span className="pulse-bar pulse-bar--b5" />
      </div>
    </div>
  );
}
