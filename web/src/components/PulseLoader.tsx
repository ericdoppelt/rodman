import { useEffect, useState } from 'react';

// Reduce Motion defaults to fully static (index.css) — the standard reading of that setting. This
// key opts a single browser back into the animation on request, so someone who wants to preview it
// doesn't have to change their OS-level accessibility setting to do it.
const FORCE_MOTION_KEY = 'rodman:forceLoaderMotion';

// A tiny live ticker: five bars run the same dip/recover story — down = red
// (the "buy the dip"), up = green (the recovery), settle = grey — staggered
// left to right so it reads as one wave sweeping across, not five bars
// blinking in place. Reads as a chart, not a chart's clip-art.
export function PulseLoader() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [forceMotion, setForceMotion] = useState(() => localStorage.getItem(FORCE_MOTION_KEY) === '1');

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(query.matches);
    const onChange = () => setPrefersReducedMotion(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <div
      className={`pulse-loader${forceMotion ? ' force-motion' : ''}`}
      aria-label="Loading picks"
      role="status"
    >
      <div className="pulse-bars">
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
      </div>
      {prefersReducedMotion && !forceMotion && (
        <button
          type="button"
          className="pulse-motion-toggle"
          onClick={() => {
            localStorage.setItem(FORCE_MOTION_KEY, '1');
            setForceMotion(true);
          }}
        >
          Show animation anyway
        </button>
      )}
    </div>
  );
}
