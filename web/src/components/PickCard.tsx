import type { Pick } from '../types';
import { PickChart } from './PickChart';
import { useInView } from '../hooks/useInView';
import { openRunFlow } from '../hooks/useHashRoute';

interface Props {
  pick: Pick;
  runDate: string;
  index: number;
}

export function PickCard({ pick, runDate, index }: Props) {
  const [ref, inView] = useInView<HTMLLIElement>();

  return (
    <li
      ref={ref}
      className={`pick-card${inView ? ' pick-card--visible' : ''}`}
      style={{ transitionDelay: `${Math.min(index, 4) * 70}ms` }}
      role="button"
      tabIndex={0}
      onClickCapture={() => openRunFlow(pick.run_id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRunFlow(pick.run_id);
        }
      }}
    >
      <span className="ticker">{pick.ticker}</span>
      <p className="reasoning">{pick.reasoning}</p>
      <PickChart series={pick.pick_price_series?.series ?? []} pickDate={runDate} entryPrice={pick.entry_price} />
      <span className="pick-card-toggle">View research process →</span>
    </li>
  );
}
