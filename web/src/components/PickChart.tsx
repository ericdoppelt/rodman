import { useEffect, useRef } from 'react';
import { createChart, AreaSeries, type UTCTimestamp } from 'lightweight-charts';
import type { PriceSeriesPoint } from '../types';
import { computePickReturn, withEntryPoint, marketCloseUnixSeconds, type Trend } from '../lib/trend';
import { TrendIcon } from './TrendIcon';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function colorForTrend(trend: Trend): { line: string; top: string } {
  if (trend === 'up') return { line: readCssVar('--status-good'), top: readCssVar('--status-good-wash') };
  if (trend === 'down') return { line: readCssVar('--status-critical'), top: readCssVar('--status-critical-wash') };
  return { line: readCssVar('--muted'), top: readCssVar('--muted-wash') };
}

interface Props {
  series: PriceSeriesPoint[];
  pickDate: string;
  entryPrice: number | null;
}

export function PickChart({ series, pickDate, entryPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const entryLineRef = useRef<HTMLDivElement>(null);
  const result = computePickReturn(series, entryPrice);

  useEffect(() => {
    const container = containerRef.current;
    const entryLineEl = entryLineRef.current;
    if (!container || !entryLineEl || series.length < 2 || !result || entryPrice == null) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 150,
      layout: {
        background: { color: 'transparent' },
        textColor: prefersDark() ? '#9ca3af' : '#6b7280',
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

    const { line: color, top: topColor } = colorForTrend(result.trend);

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor,
      bottomColor: 'rgba(0, 0, 0, 0)',
      lineWidth: 2,
      priceLineVisible: false,
    });

    const displaySeries = withEntryPoint(series, pickDate, entryPrice);
    areaSeries.setData(displaySeries.map(point => ({ time: point.time as UTCTimestamp, value: point.close })));

    const entryTime = marketCloseUnixSeconds(pickDate) as UTCTimestamp;

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

    const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onColorSchemeChange = () => {
      chart.applyOptions({ layout: { textColor: prefersDark() ? '#9ca3af' : '#6b7280' } });
    };
    colorSchemeQuery.addEventListener('change', onColorSchemeChange);

    return () => {
      resizeObserver.disconnect();
      colorSchemeQuery.removeEventListener('change', onColorSchemeChange);
      chart.remove();
    };
  }, [series, pickDate, entryPrice, result]);

  if (!result) {
    return <p className="chart-pending">Chart pending — check back after the next trading day.</p>;
  }

  const { pctReturn, trend, entryClose } = result;

  return (
    <div>
      <p className={`pick-return pick-return--${trend}`}>
        <TrendIcon trend={trend} />
        {trend === 'up' ? '+' : ''}
        {pctReturn.toFixed(2)}% since picked
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
