import { TickMarkType, type Time, type UTCTimestamp } from 'lightweight-charts';

// lightweight-charts renders every timestamp in UTC and has no timezone option. Shifting each
// point by the viewer's UTC offset makes that UTC rendering come out as their local wall-clock
// time — the approach the library documents for timezone support. Everything downstream (tick
// marks, crosshair label) therefore reads the shifted timestamps back in UTC.
export function toViewerTime(unixSeconds: number): UTCTimestamp {
  const offsetMinutes = new Date(unixSeconds * 1000).getTimezoneOffset();
  return (unixSeconds - offsetMinutes * 60) as UTCTimestamp;
}

function asDate(time: Time): Date {
  return new Date((time as number) * 1000);
}

// 12-hour clock, dropping ":00" on the hour so axis ticks stay narrow: "1 PM", "1:30 PM".
function formatClock(date: Date, locale?: string, withSeconds = false): string {
  return date.toLocaleTimeString(locale, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: date.getUTCMinutes() === 0 && !withSeconds ? undefined : '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: true,
  });
}

export function formatTickMark(time: Time, tickMarkType: TickMarkType, locale: string): string {
  const date = asDate(time);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(date.getUTCFullYear());
    // Every day tick gets "Mon D", the way Google Finance labels a multi-day intraday chart:
    // uniform labels, and no bare "Aug" that reads as Aug 1 when the first traded day is Aug 3.
    case TickMarkType.Month:
    case TickMarkType.DayOfMonth:
      return date.toLocaleDateString(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' });
    case TickMarkType.TimeWithSeconds:
      return formatClock(date, locale, true);
    default:
      return formatClock(date, locale);
  }
}

export function formatCrosshairTime(time: Time): string {
  const date = asDate(time);
  const day = date.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${day}, ${formatClock(date)}`;
}
