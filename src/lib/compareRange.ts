// The comparison range for a period: calendar presets
// compare with the previous calendar unit, everything else shifts back by whole
// weeks so weekdays line up; "Previous year" shifts 364 days for the same reason.
// Pure, shared by ScopeContext (client) and the report routes (server).
import { addDays, DateRange, daysBetween, isoDate, previousPeriod, previousYear } from './metrics';

export type ComparePreset = 'l7' | 'l30' | 'l90' | 'mtd' | 'lastmonth' | 'qtd' | 'ytd' | 'custom';

const utc = (y: number, m: number, d: number) => isoDate(new Date(Date.UTC(y, m, d)));

export function calendarPrevious(preset: ComparePreset, range: DateRange): DateRange {
  const start = new Date(`${range.start}T00:00:00Z`);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const days = daysBetween(range.start, range.end);
  switch (preset) {
    case 'lastmonth': return { start: utc(y, m - 1, 1), end: utc(y, m, 0) };
    case 'mtd': {
      const first = utc(y, m - 1, 1);
      const lastOfPrev = utc(y, m, 0);
      const end = addDays(first, days - 1);
      return { start: first, end: end > lastOfPrev ? lastOfPrev : end };
    }
    case 'qtd': {
      const first = utc(y, Math.floor(m / 3) * 3 - 3, 1);
      return { start: first, end: addDays(first, days - 1) };
    }
    case 'ytd': return { start: utc(y - 1, 0, 1), end: addDays(utc(y - 1, 0, 1), days - 1) };
    default: return previousPeriod(range);
  }
}

export function compareRangeFor(mode: string, preset: ComparePreset | string | null | undefined, range: DateRange): DateRange | null {
  if (mode === 'none') return null;
  if (mode === 'year') return previousYear(range);
  const p = (['l7', 'l30', 'l90', 'mtd', 'lastmonth', 'qtd', 'ytd', 'custom'] as const).includes(preset as ComparePreset) ? (preset as ComparePreset) : 'custom';
  return calendarPrevious(p, range);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Routes: an explicit compareStart/compareEnd from the client wins (it knows
// the preset); otherwise fall back to the mode-based range.
export function resolveCompareRange(params: URLSearchParams, range: DateRange): DateRange | null {
  const mode = params.get('compare') || 'previous';
  if (mode === 'none') return null;
  const start = params.get('compareStart');
  const end = params.get('compareEnd');
  if (start && end && DATE.test(start) && DATE.test(end) && start <= end) return { start, end };
  return compareRangeFor(mode, params.get('preset'), range);
}
