const DAY = 86_400_000;

export const toTime = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const toIso = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => toIso(toTime(iso) + days * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);

export function weekStart(iso: string): string {
  const day = new Date(toTime(iso)).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

export function periodOf(iso: string, grain: string): string {
  if (grain === 'month') return monthStart(iso);
  if (grain === 'week') return weekStart(iso);
  return iso;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));

export const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// Moves the dates inside pre-generated text along with the demo data, which always ends
// yesterday. Handles "17 August", "17 Aug 2026" and 2026-08-17.
export function shiftDatesInText(text: string, days: number, anchorYear: number): string {
  if (days === 0) return text;
  const withIso = text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, iso: string) => addDays(iso, days));
  const pattern = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')}|${SHORT.join('|')})(\\s+\\d{4})?\\b`, 'g');
  return withIso.replace(pattern, (_m, day: string, month: string, year: string | undefined) => {
    const long = month.length > 3 || month === 'May';
    const index = (long ? MONTHS : SHORT).indexOf(month);
    const sourceYear = year ? Number(year) : anchorYear;
    const iso = `${sourceYear}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
    const [y, m, d] = addDays(iso, days).split('-').map(Number);
    return `${d} ${(long ? MONTHS : SHORT)[m - 1]}${year ? ` ${y}` : ''}`;
  });
}
