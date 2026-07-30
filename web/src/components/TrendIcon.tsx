import type { Trend } from '../lib/trend';

interface Props {
  trend: Trend;
  className?: string;
}

// Shape carries the signal alongside color/text — a triangle up, triangle down,
// and a distinct diamond for flat, so trend never depends on hue alone.
export function TrendIcon({ trend, className }: Props) {
  const cls = ['trend-icon', className].filter(Boolean).join(' ');
  if (trend === 'up') {
    return (
      <svg className={cls} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1 L9 8 L1 8 Z" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg className={cls} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 9 L1 2 L9 2 Z" />
      </svg>
    );
  }
  return (
    <svg className={cls} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1 L9 5 L5 9 L1 5 Z" />
    </svg>
  );
}
