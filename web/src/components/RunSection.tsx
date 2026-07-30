import type { Run } from '../types';
import { PickCard } from './PickCard';
import { useInView } from '../hooks/useInView';

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface Props {
  run: Run;
}

export function RunSection({ run }: Props) {
  const [ref, inView] = useInView<HTMLElement>();

  return (
    <section ref={ref} className={`run${inView ? ' run--visible' : ''}`}>
      <div className="run-header">
        <h2>{formatDate(run.run_date)}</h2>
        {run.total_cost_usd != null && <span className="cost">${run.total_cost_usd.toFixed(4)}</span>}
      </div>
      {run.picks.length === 0 ? (
        <p className="no-pick">No pick met the bar this day.</p>
      ) : (
        <ul className="picks">
          {run.picks.map((pick, index) => (
            <PickCard key={pick.id} pick={pick} runDate={run.run_date} index={index} />
          ))}
        </ul>
      )}
    </section>
  );
}
