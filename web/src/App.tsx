import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import type { Run } from './types';
import { computeMetrics } from './lib/metrics';
import { RunSection } from './components/RunSection';
import { StatTile } from './components/StatTile';
import { PulseLoader } from './components/PulseLoader';
import { RunFlowPage } from './components/RunFlowPage';
import { useHashRunId } from './hooks/useHashRoute';

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function toneOfDelta(n: number | null | undefined): 'up' | 'down' | 'neutral' {
  if (n == null || n === 0) return 'neutral';
  return n > 0 ? 'up' : 'down';
}

function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const flowRunId = useHashRunId();

  useEffect(() => {
    const fetchRuns = supabase
      .from('runs')
      .select('id, run_date, status, total_cost_usd, created_at, completed_at, picks(id, run_id, ticker, reasoning, entry_price, created_at, pick_price_series(series))')
      .order('run_date', { ascending: false });

    // Local/fast connections can resolve this in well under one pulse cycle —
    // hold the loading state for a minimum stretch so the animation is
    // actually visible instead of flashing past unseen.
    const minDisplay = new Promise(resolve => setTimeout(resolve, 2000));

    Promise.all([fetchRuns, minDisplay]).then(([{ data, error }]) => {
      if (error) {
        setError(error.message);
      } else {
        setRuns(data as unknown as Run[]);
      }
      setLoading(false);
    });
  }, []);

  const metrics = useMemo(() => computeMetrics(runs), [runs]);

  return (
    <>
      <div className="bg-aurora" aria-hidden="true">
        <span className="bg-blob bg-blob--a" />
        <span className="bg-blob bg-blob--b" />
        <span className="bg-blob bg-blob--c" />
      </div>

      {flowRunId ? (
        <RunFlowPage runId={flowRunId} />
      ) : (
      <main>
        <header className="hero">
          <h1>Rodman</h1>
          <p className="subtitle">Daily dip-buy picks from an automated research pipeline.</p>
        </header>

        {loading && (
          <div className="loading-screen">
            <PulseLoader />
          </div>
        )}

        {error && <p className="error">Failed to load runs: {error}</p>}

        {!loading && !error && runs.length === 0 && <p className="no-pick">No completed runs yet.</p>}

        {!loading && !error && runs.length > 0 && (
          <>
            <section className="kpi-row" aria-label="Aggregate performance">
              <StatTile
                label="Total picks"
                value={metrics.totalPicks}
                format={n => Math.round(n).toString()}
              />
              <StatTile
                label="Win rate"
                value={metrics.winRate}
                format={n => `${n.toFixed(0)}%`}
                fallback="n/a"
                sublabel={metrics.winRate === null ? 'no decided picks yet' : `${metrics.wins}W – ${metrics.losses}L – ${metrics.flats}T`}
                tone={metrics.winRate === null ? 'neutral' : metrics.winRate > 50 ? 'up' : metrics.winRate < 50 ? 'down' : 'neutral'}
              />
              <StatTile
                label="Avg return"
                value={metrics.avgReturnPct}
                format={n => signed(n)}
                fallback="n/a"
                tone={toneOfDelta(metrics.avgReturnPct)}
              />
              <StatTile
                label="Best pick"
                value={metrics.best?.pctReturn ?? null}
                format={n => signed(n)}
                fallback="n/a"
                sublabel={metrics.best ? `${metrics.best.ticker} · ${formatDate(metrics.best.runDate)}` : undefined}
                tone={toneOfDelta(metrics.best?.pctReturn)}
              />
            </section>

            <div className="runs">
              {runs.map(run => (
                <RunSection key={run.id} run={run} />
              ))}
            </div>
          </>
        )}
      </main>
      )}
    </>
  );
}

export default App;
