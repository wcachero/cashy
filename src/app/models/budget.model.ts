export type CutoffType = '10TH_CUTOFF' | '15TH_CUTOFF' | '25TH_CUTOFF' | '30TH_CUTOFF' | '30TH_INFLOW' | 'BONUS' | 'CASH_ADVANCE';

export type LiabilityCategory =
  | 'LIVING_EXPENSE'
  | 'FIXED_LOAN'
  | 'REVOLVING_CC'
  | 'ONE_TIME_OLA'
  | 'PAST_DUE_OLA'
  | 'PERSONAL_DEBT';

export type ItemStatus = 'ACTIVE' | 'PAST_DUE' | 'PAID' | 'SCHEDULED';

export type AssignedCutoff = '10TH_CUTOFF' | '25TH_CUTOFF' | 'BOTH';

export interface BalanceAdjustment {
  id: string;
  date: string;
  description: string;
  amountAdded: number;
}

export interface IncomeStream {
  id: string;
  name: string;
  amount: number;
  dayOfMonth: number;
  cutoffType: CutoffType;
  remainingMonths?: number;
  isOneTime?: boolean;
  specificDate?: string;
}

export interface LiabilityItem {
  id: string;
  name: string;
  /** Lender, card issuer, or OLA app name used in exports. */
  bankName?: string;
  category: LiabilityCategory;
  totalBalance: number;
  /** Balance before cash advances, fees, and payments. */
  initialBalance?: number;
  adjustments?: BalanceAdjustment[];
  monthlyAmortization: number;
  minimumDue?: number;
  dueDayOfMonth: number;
  assignedCutoff: AssignedCutoff;
  remainingTerms?: number;
  startDate: string;
  endDate?: string;
  status: ItemStatus;
  priorityRank: number;
  notes?: string;
  /** Balance when the plan was created or the bill was added. Used for payoff progress. */
  originalBalance?: number;
  originalTerms?: number;
  /** Household costs that are split evenly across the 10th and 25th cutoffs. */
  splitAcrossCutoffs?: boolean;
  isFrozenPastDue?: boolean;
}

export interface CutoffAllocationItem {
  id: string;
  liabilityId: string;
  name: string;
  category: LiabilityCategory;
  dueDate: string;
  plannedAmount: number;
  actualPaidAmount: number;
  minimumDue?: number;
  isPaid: boolean;
  paymentNote?: string;
  /** When false, checking the row paid does not consume an installment term. */
  countsAsTerm?: boolean;
  appliedBalance?: number;
  appliedTerm?: boolean;
  clearedTerms?: number;
  appliedStatus?: ItemStatus;
}

export interface PaycheckCycle {
  id: string;
  label: string;
  cutoffDate: string;
  baseIncome: number;
  supplementaryIncome: number;
  carryOverFromPrevious: number;
  sinkingFundReserved: number;
  allocations: CutoffAllocationItem[];
}

export interface BankSaving {
  id: string;
  bankName: string;
  accountName: string;
  amount: number;
  notes?: string;
}

export interface Receivable {
  id: string;
  name: string;
  totalDebt: number;
  amountReceived: number;
  paymentAmount: number;
  terms: number;
  /** Day of the month the payment is expected, such as the 30th for a land installment. */
  dueDayOfMonth?: number;
  /** Date the person borrowed the money. */
  borrowedOn?: string;
  /** Remarks for this person. */
  notes?: string;
}

export interface BudgetSnapshot {
  version: 1;
  incomeStreams: IncomeStream[];
  liabilities: LiabilityItem[];
  paycheckCycles: PaycheckCycle[];
  notificationsEnabled: boolean;
  bankSavings: BankSaving[];
  receivables: Receivable[];
  hideDebtTotal?: boolean;
  hideSavingsTotal?: boolean;
  revision?: number;
}

export interface UpcomingDue {
  liabilityId: string;
  name: string;
  category: LiabilityCategory;
  dueDate: string;
  daysUntil: number;
  suggestedAmount: number;
  fullBalance: number;
  minimumDue?: number;
}

export interface Milestone {
  id: string;
  date: string;
  title: string;
  detail: string;
  done: boolean;
}

export interface DebtSlice {
  category: LiabilityCategory;
  label: string;
  amount: number;
  percent: number;
  barClass: string;
}

export interface FreeCashStep {
  label: string;
  detail: string;
  amount: number;
}
