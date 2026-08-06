import {
  defaultHorzScaleBehavior,
  type Mutable,
  type TickMarkWeightValue,
  type TimeChartOptions,
  type TimeScalePoint,
} from 'lightweight-charts';

// The stock time scale weights the first bar of a new month heavier than the first bar of a new
// day. Tick placement is greedy from the heaviest weight down, so that one bar anchors the axis
// and the day ticks fill in around it — producing a ragged run like "Jul 27, Jul 29, Jul 30,
// Aug 3, Aug 5". Giving every trading day the same weight makes placement a plain even stride.
const DAY_START = 50 as TickMarkWeightValue;
const WITHIN_DAY = 0 as TickMarkWeightValue;

// Times reaching the chart are already shifted into the viewer's zone (see toViewerTime in
// chartTime.ts), so a UTC day boundary is their day boundary.
function startsNewDay(time: number, previous: number): boolean {
  const day = 24 * 60 * 60;
  return Math.floor(time / day) !== Math.floor(previous / day);
}

const DefaultHorzScaleBehavior = defaultHorzScaleBehavior();

export class DayTickHorzScaleBehavior extends DefaultHorzScaleBehavior {
  // The base signature returns ChartOptionsImpl<Time>, which omits timeScale.tickMarkFormatter;
  // narrowing it to TimeChartOptions is what lets createChartEx accept that option.
  declare options: () => TimeChartOptions;

  override fillWeightsForPoints(points: readonly Mutable<TimeScalePoint>[], startIndex: number): void {
    for (let index = Math.max(startIndex, 0); index < points.length; index++) {
      const time = points[index].originalTime as number;
      const previous = index > 0 ? (points[index - 1].originalTime as number) : null;
      points[index].timeWeight = previous === null || startsNewDay(time, previous) ? DAY_START : WITHIN_DAY;
    }
  }
}
