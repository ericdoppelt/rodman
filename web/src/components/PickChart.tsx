import { useEffect, useRef } from 'react';
import { createChart, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import type { PriceSeriesPoint } from '../types';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function dateStringOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

type Trend = 'up' | 'down' | 'flat';

function trendOf(entryClose: number, latestClose: number): Trend {
  if (latestClose > entryClose) return 'up';
  if (latestClose < entryClose) return 'down';
  return 'flat';
}

// The pipeline runs on end-of-day data, so a pick is anchored to the *close* of pickDate,
// not its open — the dip that triggers a pick can happen intraday (e.g. an afternoon
// reversal), so marking the day's first bar would place "Picked" before the drop even happened.
function findEntryIndex(series: PriceSeriesPoint[], pickDate: string): number {
  let lastOnPickDate = -1;
  for (let i = 0; i < series.length; i++) {
    const barDate = dateStringOf(series[i].time);
    if (barDate === pickDate) lastOnPickDate = i;
    else if (barDate > pickDate) break;
  }
  if (lastOnPickDate !== -1) return lastOnPickDate;
  const fallback = series.findIndex(point => dateStringOf(point.time) >= pickDate);
  return fallback === -1 ? 0 : fallback;
}

interface Props {
  series: PriceSeriesPoint[];
  pickDate: string;
}

export function PickChart({ series, pickDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const entryLineRef = useRef<HTMLDivElement>(null);
  const entryIndex = findEntryIndex(series, pickDate);

  useEffect(() => {
    const container = containerRef.current;
    const entryLineEl = entryLineRef.current;
    if (!container || !entryLineEl || series.length < 2) return;

    const dark = prefersDark();
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 150,
      layout: {
        background: { color: 'transparent' },
        textColor: dark ? '#9ca3af' : '#6b7280',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    const entryClose = series[entryIndex].close;
    const latestClose = series[series.length - 1].close;
    const trend = trendOf(entryClose, latestClose);
    const color = trend === 'up' ? '#16a34a' : trend === 'down' ? '#dc2626' : '#6b7280';

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: trend === 'up' ? 'rgba(22, 163, 74, 0.28)' : trend === 'down' ? 'rgba(220, 38, 38, 0.28)' : 'rgba(107, 114, 128, 0.2)',
      bottomColor: 'rgba(0, 0, 0, 0)',
      lineWidth: 2,
      priceLineVisible: false,
    });

    areaSeries.setData(series.map(point => ({ time: point.time as UTCTimestamp, value: point.close })));

    const entryTime = series[entryIndex].time as UTCTimestamp;

    const positionEntryLine = () => {
      const x = chart.timeScale().timeToCoordinate(entryTime);
      if (x === null) {
        entryLineEl.style.display = 'none';
      } else {
        entryLineEl.style.display = 'block';
        entryLineEl.style.left = `${x}px`;
      }
    };

    chart.timeScale().fitContent();
    positionEntryLine();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
      positionEntryLine();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [series, entryIndex]);

  if (series.length < 2) {
    return <p className="chart-pending">Chart pending — check back after the next trading day.</p>;
  }

  const entryClose = series[entryIndex].close;
  const latestClose = series[series.length - 1].close;
  const pctReturn = ((latestClose - entryClose) / entryClose) * 100;
  const trend = trendOf(entryClose, latestClose);
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '●';

  return (
    <div>
      <p className={`pick-return ${trend}`}>
        {arrow} {trend === 'up' ? '+' : ''}{pctReturn.toFixed(2)}% since picked
      </p>
      <div className="pick-chart-wrap">
        <div ref={containerRef} className="pick-chart" />
        <div ref={entryLineRef} className="pick-chart-entry-line">
          <span>Picked · ${entryClose.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
