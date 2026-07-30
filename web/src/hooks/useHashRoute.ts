import { useEffect, useState } from 'react';

function parseRunId(): string | null {
  const match = window.location.hash.match(/^#\/run\/(.+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

// Minimal hash-based route for the per-run flow page — avoids pulling in a
// router dependency for what is currently a single detail view.
export function useHashRunId(): string | null {
  const [runId, setRunId] = useState<string | null>(() => parseRunId());

  useEffect(() => {
    const onHashChange = () => setRunId(parseRunId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return runId;
}

export function openRunFlow(runId: string): void {
  window.location.hash = `#/run/${encodeURIComponent(runId)}`;
}

export function closeRunFlow(): void {
  window.location.hash = '';
}
