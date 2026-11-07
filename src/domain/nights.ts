import { CUTOFF_HOUR, TZ } from '../config';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

const pad = (n: number) => String(n).padStart(2, '0');

/** Raid night date (YYYY-MM-DD) for a unix timestamp; before CUTOFF_HOUR local belongs to the previous date. */
export function nightDateFor(t: number): string {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(new Date(t * 1000))) p[part.type] = part.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), h = Number(p.hour);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  if (h < CUTOFF_HOUR) noon.setUTCDate(noon.getUTCDate() - 1);
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** ISO 8601 week number of a YYYY-MM-DD date. */
export function isoWeek(date: string): number {
  const dt = parseDate(date);
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // Thursday of this week
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1, 12);
  return Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. `Wk 46 · Wed 11 Nov` */
export function nightLabel(date: string): string {
  const dt = parseDate(date);
  return `Wk ${isoWeek(date)} · ${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}
