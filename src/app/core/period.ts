import { parseIsoDate } from './dates';

export const MONTH_OPTIONS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function dateInPeriod(iso: string, month: string, year: string): boolean {
  if (month === 'all' && year === 'all') return true;
  const date = parseIsoDate(iso);
  if (month !== 'all' && date.getMonth() + 1 !== Number(month)) return false;
  if (year !== 'all' && date.getFullYear() !== Number(year)) return false;
  return true;
}

export function rangeOverlapsPeriod(startIso: string | undefined, endIso: string | undefined, month: string, year: string): boolean {
  if (month === 'all' && year === 'all') return true;
  if (!startIso) return false;
  const start = parseIsoDate(startIso);
  const end = endIso ? parseIsoDate(endIso) : null;
  const years = year === 'all' ? yearsInSpan(start, end) : [Number(year)];
  const months = month === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [Number(month)];
  for (const periodYear of years) {
    for (const periodMonth of months) {
      const periodStart = new Date(periodYear, periodMonth - 1, 1);
      const periodEnd = new Date(periodYear, periodMonth, 0);
      if (start <= periodEnd && (end == null || end >= periodStart)) return true;
    }
  }
  return false;
}

export function collectYears(dates: Array<string | undefined>, spans: Array<{ start?: string; end?: string }> = []): number[] {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const iso of dates) {
    if (iso) years.add(parseIsoDate(iso).getFullYear());
  }
  for (const span of spans) {
    if (!span.start) continue;
    for (const year of yearsInSpan(parseIsoDate(span.start), span.end ? parseIsoDate(span.end) : null)) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function yearsInSpan(start: Date, end: Date | null): number[] {
  const from = start.getFullYear();
  const to = end ? end.getFullYear() : from;
  const years: number[] = [];
  for (let year = from; year <= to; year += 1) years.push(year);
  return years;
}
