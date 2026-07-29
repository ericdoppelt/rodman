import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import type { Run } from './types';
import { PickChart } from './components/PickChart';

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('runs')
      .select('id, run_date, status, total_cost_usd, created_at, completed_at, picks(id, run_id, ticker, reasoning, created_at, pick_price_series(series))')
      .order('run_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setRuns(data as unknown as Run[]);
        }
        setLoading(false);
      });
  }, []);

  return (
    <main>
      <header>
        <h1>Stock Agent</h1>
        <p className="subtitle">Daily dip-buy picks from an automated research pipeline.</p>
      </header>

      {loading && <p>Loading...</p>}
      {error && <p className="error">Failed to load runs: {error}</p>}

      {!loading && !error && runs.length === 0 && <p>No completed runs yet.</p>}

      <div className="runs">
        {runs.map(run => (
          <section key={run.id} className="run">
            <div className="run-header">
              <h2>{formatDate(run.run_date)}</h2>
              {run.total_cost_usd != null && (
                <span className="cost">${run.total_cost_usd.toFixed(4)}</span>
              )}
            </div>
            {run.picks.length === 0 ? (
              <p className="no-pick">No pick met the bar this day.</p>
            ) : (
              <ul className="picks">
                {run.picks.map(pick => (
                  <li key={pick.id} className="pick">
                    <span className="ticker">{pick.ticker}</span>
                    <p className="reasoning">{pick.reasoning}</p>
                    <PickChart
                      series={pick.pick_price_series?.series ?? []}
                      pickDate={run.run_date}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

export default App;
