import { useCountUp } from '../hooks/useCountUp';

interface Props {
  label: string;
  value: number | null;
  format: (n: number) => string;
  fallback?: string;
  tone?: 'up' | 'down' | 'neutral';
  sublabel?: string;
}

export function StatTile({ label, value, format, fallback = '—', tone = 'neutral', sublabel }: Props) {
  const animated = useCountUp(value);

  return (
    <div className={`stat-tile stat-tile--${tone}`}>
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value">{animated === null ? fallback : format(animated)}</span>
      {sublabel && <span className="stat-tile-sublabel">{sublabel}</span>}
    </div>
  );
}
