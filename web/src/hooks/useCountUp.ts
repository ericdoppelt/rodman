import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// Animates toward `target` from 0 on first appearance. Renders the final value
// immediately (no motion) when the target is null/still loading or the user
// prefers reduced motion.
export function useCountUp(target: number | null, durationMs = 900): number | null {
  const [value, setValue] = useState<number | null>(target === null ? null : 0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (target === null) return;

    if (hasAnimated.current || prefersReducedMotion()) {
      setValue(target);
      hasAnimated.current = true;
      return;
    }
    hasAnimated.current = true;

    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      setValue(target * easeOutExpo(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
