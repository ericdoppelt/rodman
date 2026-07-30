import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { closeRunFlow } from '../hooks/useHashRoute';
import { RunFlowDetail } from './RunFlowDetail';
import { PulseLoader } from './PulseLoader';

interface RunHeader {
  run_date: string;
  total_cost_usd: number | null;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface Props {
  runId: string;
}

export function RunFlowPage({ runId }: Props) {
  const [run, setRun] = useState<RunHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    supabase
      .from('runs')
      .select('run_date, total_cost_usd')
      .eq('id', runId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setRun(data as RunHeader);
        }
        setLoading(false);
      });
  }, [runId]);

  if (loading) {
    return (
      <div className="loading-screen">
        <PulseLoader />
      </div>
    );
  }

  if (error || !run) {
    return (
      <main className="flow-page">
        <button className="flow-back" onClick={closeRunFlow}>← Back</button>
        <p className="error">Failed to load run: {error ?? 'not found'}</p>
      </main>
    );
  }

  return (
    <main className="flow-page">
      <button className="flow-back" onClick={closeRunFlow}>← Back</button>
      <header className="flow-header">
        <h1>{formatDate(run.run_date)}</h1>
        {run.total_cost_usd != null && <span className="cost">${run.total_cost_usd.toFixed(4)}</span>}
      </header>

      <RunFlowDetail runId={runId} />
    </main>
  );
}
