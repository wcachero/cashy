import { BudgetSnapshot, LiabilityItem } from '../models/budget.model';

export interface FinanceExport {
  kind: 'cutoff-finance-export';
  version: 1;
  asOf: string;
  currency: 'PHP';
  income: BudgetSnapshot['incomeStreams'];
  expenses: LiabilityItem[];
  olas: LiabilityItem[];
  creditCards: LiabilityItem[];
  loans: LiabilityItem[];
  personalDebts: LiabilityItem[];
  cycles: BudgetSnapshot['paycheckCycles'];
  bankSavings: BudgetSnapshot['bankSavings'];
  receivables: BudgetSnapshot['receivables'];
  snapshot: BudgetSnapshot;
}

function withBank(item: LiabilityItem): LiabilityItem {
  return { ...item, bankName: item.bankName?.trim() || item.name };
}

export function toFinanceExport(snapshot: BudgetSnapshot, asOf = '2026-10-15'): FinanceExport {
  const items = snapshot.liabilities.map(withBank);
  return {
    kind: 'cutoff-finance-export',
    version: 1,
    asOf,
    currency: 'PHP',
    income: snapshot.incomeStreams,
    expenses: items.filter((item) => item.category === 'LIVING_EXPENSE'),
    olas: items.filter((item) => item.category === 'ONE_TIME_OLA' || item.category === 'PAST_DUE_OLA'),
    creditCards: items.filter((item) => item.category === 'REVOLVING_CC'),
    loans: items.filter((item) => item.category === 'FIXED_LOAN'),
    personalDebts: items.filter((item) => item.category === 'PERSONAL_DEBT'),
    cycles: snapshot.paycheckCycles,
    bankSavings: snapshot.bankSavings ?? [],
    receivables: snapshot.receivables ?? [],
    snapshot,
  };
}

function asLiabilities(value: unknown): LiabilityItem[] | null {
  return Array.isArray(value) ? (value as LiabilityItem[]) : null;
}

function snapshotFromFinanceFile(record: Record<string, unknown>): BudgetSnapshot | null {
  const expenses = asLiabilities(record['expenses']);
  const olas = asLiabilities(record['olas']);
  const creditCards = asLiabilities(record['creditCards']);
  const loans = asLiabilities(record['loans']);
  const personalDebts = asLiabilities(record['personalDebts']);
  if (!Array.isArray(record['income']) || !Array.isArray(record['cycles']) || !expenses || !olas || !creditCards || !loans || !personalDebts) {
    return null;
  }
  return {
    version: 1,
    incomeStreams: record['income'] as BudgetSnapshot['incomeStreams'],
    liabilities: [...loans, ...creditCards, ...olas, ...personalDebts, ...expenses],
    paycheckCycles: record['cycles'] as BudgetSnapshot['paycheckCycles'],
    notificationsEnabled: false,
    bankSavings: Array.isArray(record['bankSavings']) ? (record['bankSavings'] as BudgetSnapshot['bankSavings']) : [],
    receivables: Array.isArray(record['receivables']) ? (record['receivables'] as BudgetSnapshot['receivables']) : [],
  };
}

function mergeLiabilities(primary: LiabilityItem[], overlay: LiabilityItem[]): LiabilityItem[] {
  const byId = new Map(overlay.map((item) => [item.id, item]));
  const merged = primary.map((item) => byId.get(item.id) ?? item);
  const seen = new Set(merged.map((item) => item.id));
  return [...merged, ...overlay.filter((item) => !seen.has(item.id))];
}

export function snapshotFromImport(value: unknown): BudgetSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'cutoff-finance-export') {
    const fromFile = snapshotFromFinanceFile(record);
    const nested = snapshotFromImport(record['snapshot']);
    if (fromFile && nested) {
      return {
        ...fromFile,
        liabilities: mergeLiabilities(nested.liabilities, fromFile.liabilities),
        notificationsEnabled: nested.notificationsEnabled,
      };
    }
    return fromFile ?? nested;
  }
  if (!Array.isArray(record['incomeStreams']) || !Array.isArray(record['liabilities']) || !Array.isArray(record['paycheckCycles'])) {
    return null;
  }
  return {
    version: 1,
    incomeStreams: record['incomeStreams'] as BudgetSnapshot['incomeStreams'],
    liabilities: record['liabilities'] as BudgetSnapshot['liabilities'],
    paycheckCycles: record['paycheckCycles'] as BudgetSnapshot['paycheckCycles'],
    notificationsEnabled: Boolean(record['notificationsEnabled']),
    bankSavings: Array.isArray(record['bankSavings']) ? (record['bankSavings'] as BudgetSnapshot['bankSavings']) : [],
    receivables: Array.isArray(record['receivables']) ? (record['receivables'] as BudgetSnapshot['receivables']) : [],
  };
}
