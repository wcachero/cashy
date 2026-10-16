import { AssignedCutoff, CutoffPair, ItemStatus, LiabilityCategory } from '../models/budget.model';
import { shiftMonth } from './dates';

export interface CategoryMeta {
  label: string;
  badgeClass: string;
  barClass: string;
}

export const CATEGORY_META: Record<LiabilityCategory, CategoryMeta> = {
  LIVING_EXPENSE: {
    label: 'Living',
    badgeClass: 'bg-sky-400/15 text-sky-200 ring-sky-400/30',
    barClass: 'bg-sky-400',
  },
  FIXED_LOAN: {
    label: 'Fixed loan',
    badgeClass: 'bg-violet-400/15 text-violet-200 ring-violet-400/30',
    barClass: 'bg-violet-400',
  },
  REVOLVING_CC: {
    label: 'Credit card',
    badgeClass: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
    barClass: 'bg-amber-400',
  },
  ONE_TIME_OLA: {
    label: 'One-time OLA',
    badgeClass: 'bg-orange-400/15 text-orange-200 ring-orange-400/30',
    barClass: 'bg-orange-400',
  },
  PAST_DUE_OLA: {
    label: 'Past due',
    badgeClass: 'bg-rose-400/15 text-rose-200 ring-rose-400/30',
    barClass: 'bg-rose-400',
  },
  PERSONAL_DEBT: {
    label: 'Personal',
    badgeClass: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30',
    barClass: 'bg-emerald-400',
  },
};

export const STATUS_META: Record<ItemStatus, { label: string; badgeClass: string }> = {
  ACTIVE: { label: 'Active', badgeClass: 'bg-sky-400/15 text-sky-200 ring-sky-400/25' },
  PAST_DUE: { label: 'Past due', badgeClass: 'bg-rose-400/15 text-rose-200 ring-rose-400/30' },
  PAID: { label: 'Paid', badgeClass: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30' },
  SCHEDULED: { label: 'Scheduled', badgeClass: 'bg-violet-400/15 text-violet-200 ring-violet-400/25' },
};

export const CATEGORY_FILTERS: Array<LiabilityCategory | 'ALL'> = [
  'ALL',
  'FIXED_LOAN',
  'REVOLVING_CC',
  'ONE_TIME_OLA',
  'PAST_DUE_OLA',
  'PERSONAL_DEBT',
  'LIVING_EXPENSE',
];

export function categoryLabel(category: LiabilityCategory | 'ALL'): string {
  if (category === 'ALL') return 'All';
  return CATEGORY_META[category].label;
}

export function cutoffLabel(cutoff: AssignedCutoff): string {
  if (cutoff === 'BOTH') return '10th & 25th';
  if (cutoff === '15_30') return '15th & 30th';
  if (cutoff === '15TH_CUTOFF') return '15th';
  if (cutoff === '30TH_CUTOFF') return '30th';
  return cutoff === '10TH_CUTOFF' ? '10th' : '25th';
}

export function cutoffDays(cutoff: AssignedCutoff): number[] {
  if (cutoff === 'BOTH') return [10, 25];
  if (cutoff === '15_30') return [15, 30];
  if (cutoff === '15TH_CUTOFF') return [15];
  if (cutoff === '30TH_CUTOFF') return [30];
  return cutoff === '10TH_CUTOFF' ? [10] : [25];
}

export function isPairCutoff(cutoff: AssignedCutoff): boolean {
  return cutoff === 'BOTH' || cutoff === '15_30';
}

export function pairDays(pair: CutoffPair): number[] {
  return pair === '15_30' ? [15, 30] : [10, 25];
}

export function pairLabel(pair: CutoffPair): string {
  return pair === '15_30' ? '15th and 30th' : '10th and 25th';
}

export function asCutoffPair(value: unknown): CutoffPair {
  return value === '15_30' ? '15_30' : '10_25';
}

/** Which payday in the pair funds a due day. */
export function cutoffFromDueDay(dueDayOfMonth: number, pair: CutoffPair = '10_25'): AssignedCutoff {
  const day = Math.min(31, Math.max(1, Math.round(dueDayOfMonth)));
  if (pair === '15_30') {
    if (day >= 16 && day <= 29) return '15TH_CUTOFF';
    return '30TH_CUTOFF';
  }
  if (day >= 11 && day <= 24) return '10TH_CUTOFF';
  return '25TH_CUTOFF';
}

/** Bills due on the 11th–24th are funded by the 10th salary. Everything else waits for the 25th. */
export function defaultCutoff(dueDayOfMonth: number, pair: CutoffPair = '10_25'): AssignedCutoff {
  return cutoffFromDueDay(dueDayOfMonth, pair);
}

/** Cutoff date that pays a due date in the active pair. */
export function fundingCutoffDate(dueIso: string, pair: CutoffPair): { cutoff: AssignedCutoff; cutoffDate: string } {
  const day = Number(dueIso.slice(8, 10)) || 1;
  const cutoff = cutoffFromDueDay(day, pair);
  if (pair === '15_30') {
    if (day >= 16 && day <= 29) return { cutoff, cutoffDate: shiftMonth(dueIso, 0, 15) };
    if (day >= 30) return { cutoff, cutoffDate: shiftMonth(dueIso, 0, 30) };
    return { cutoff, cutoffDate: shiftMonth(dueIso, -1, 30) };
  }
  if (day >= 11 && day <= 24) return { cutoff, cutoffDate: shiftMonth(dueIso, 0, 10) };
  if (day >= 25) return { cutoff, cutoffDate: shiftMonth(dueIso, 0, 25) };
  return { cutoff, cutoffDate: shiftMonth(dueIso, -1, 25) };
}
