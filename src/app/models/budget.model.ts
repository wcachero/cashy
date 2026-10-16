export type CutoffType = '10TH_CUTOFF' | '15TH_CUTOFF' | '25TH_CUTOFF' | '30TH_CUTOFF' | '30TH_INFLOW' | 'BONUS' | 'CASH_ADVANCE';

export type LiabilityCategory =
  | 'LIVING_EXPENSE'
  | 'FIXED_LOAN'
  | 'REVOLVING_CC'
  | 'ONE_TIME_OLA'
  | 'PAST_DUE_OLA'
  | 'PERSONAL_DEBT';

export type ItemStatus = 'ACTIVE' | 'PAST_DUE' | 'PAID' | 'SCHEDULED';

export type AssignedCutoff = '10TH_CUTOFF' | '15TH_CUTOFF' | '25TH_CUTOFF' | '30TH_CUTOFF' | 'BOTH' | '15_30';
export type CutoffPair = '10_25' | '15_30';

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
  /** Registered bank, e-wallet, or `'cash'` for cash on hand, when this income is deposited. */
  accountId?: string;
  /** Cutoffs on or after this date are deposited to the account; earlier ones are left alone. */
  depositsFrom?: string;
  /** For one-time income: the day it was credited to its account. */
  depositedOn?: string;
}

/** One deposit of income. Amounts can differ every cutoff; there is no repeating salary figure. */
export interface IncomeReceipt {
  id: string;
  name: string;
  kind: 'salary' | 'other';
  amount: number;
  receivedOn: string;
  cycleId: string;
  cutoffDate: string;
  accountId?: string;
  credited: boolean;
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
  /** True when the monthly amount is split across a cutoff pair (10th & 25th, or 15th & 30th). */
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
  /** How the bill was paid: cash on hand or a bank transfer. */
  paymentMethod?: PaymentMethod;
  /** Registered bank or e-wallet used for a bank transfer. */
  paymentAccountId?: string;
  /** Name of the bank or e-wallet at the time of payment. */
  paymentSource?: string;
  /** Savings balance the transfer was taken from. */
  paymentSavingsId?: string;
  /** Amount actually taken from cash on hand or the savings balance, restored when unmarked. */
  paymentDeducted?: number;
  /** When a bill is split across cash and banks, each slice is stored here. */
  paymentShares?: AllocationPaymentShare[];
  /** Shared bill this row belongs to. */
  sharedExpenseId?: string;
  /** Person's share on a shared bill. Paid by them, not from your savings. */
  shareId?: string;
}

export interface AllocationPaymentShare {
  method: PaymentMethod;
  accountId?: string;
  source?: string;
  savingsId?: string;
  amount: number;
  deducted: number;
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
  /** Income streams already deposited to their bank or e-wallet for this cutoff. */
  depositedStreamIds?: string[];
  /** Salary actually received for this cutoff. Replaces baseIncome in totals once logged. */
  actualIncome?: number;
  /** The (actual − expected) difference already applied to the salary's bank balance. */
  actualDeltaApplied?: number;
}

export type MoneyAccountKind = 'BANK' | 'PAYROLL' | 'E_WALLET';

/** Sentinel used on income.accountId when the money lands in cash on hand. */
export const CASH_DEPOSIT_ID = 'cash';

export const ACCOUNT_KIND_LABEL: Record<MoneyAccountKind, string> = { BANK: 'Bank', PAYROLL: 'Payroll account', E_WALLET: 'E-wallet' };

export function asAccountKind(value: unknown): MoneyAccountKind {
  return value === 'E_WALLET' || value === 'PAYROLL' ? value : 'BANK';
}

/** A bank or e-wallet you registered, used for bank-transfer payments and savings balances. */
export interface MoneyAccount {
  id: string;
  name: string;
  kind: MoneyAccountKind;
  notes?: string;
}

export type PaymentMethod = 'CASH' | 'BANK';

/** One movement on a bank or e-wallet balance, with the balance right after it. */
export interface AccountTransaction {
  id: string;
  /** Savings row the money moved on. */
  savingsId: string;
  /** Registered bank or e-wallet that row belongs to, when linked. */
  accountId?: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balanceAfter: number;
  description: string;
}

export interface BankSaving {
  id: string;
  bankName: string;
  accountName: string;
  amount: number;
  notes?: string;
  /** Registered bank or e-wallet this balance belongs to. */
  accountId?: string;
}

export interface CutoffWithdrawal {
  id: string;
  /** Cutoff the cash came from. Empty when the withdrawal came from a savings account. */
  cycleId?: string;
  /** Savings account the cash came from. */
  savingsId?: string;
  /** Bank and account name at the time of withdrawal, kept for history after the account is removed. */
  sourceName?: string;
  amount: number;
  withdrawnOn: string;
  note?: string;
  /** True when this withdrawal was added to cash on hand, so removing it takes the cash back. */
  addedToCash?: boolean;
  /** For cutoff withdrawals: the bank or e-wallet balance the salary cash physically came out of, and how much. */
  accountSavingsId?: string;
  accountDeducted?: number;
}

export interface ReceivablePayment {
  id: string;
  /** Day the person actually paid. */
  date: string;
  amount: number;
  /** Cutoff that received this payment. */
  cycleId?: string;
  cutoffDate?: string;
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
  /** Payments already logged, newest last. */
  payments?: ReceivablePayment[];
  /** Set when this row was created from a shared expense. */
  sharedExpenseId?: string;
  shareId?: string;
}

export interface SharedExpenseShare {
  id: string;
  name: string;
  amount: number;
  paid: boolean;
  paidOn?: string;
  /** Cutoff that received this share when it was marked paid. */
  creditedOn?: string;
  creditedAmount?: number;
  receivableId: string;
}

export interface SharedExpense {
  id: string;
  name: string;
  totalAmount: number;
  /** Date of the bill being split. */
  expenseDate: string;
  /** Living expense created from this shared bill. */
  liabilityId?: string;
  shares: SharedExpenseShare[];
}

export interface BudgetSnapshot {
  version: 1;
  incomeStreams: IncomeStream[];
  liabilities: LiabilityItem[];
  paycheckCycles: PaycheckCycle[];
  notificationsEnabled: boolean;
  bankSavings: BankSaving[];
  receivables: Receivable[];
  withdrawals?: CutoffWithdrawal[];
  sharedExpenses?: SharedExpense[];
  /** Registered banks and e-wallets. */
  accounts?: MoneyAccount[];
  /** Physical cash you are holding. Withdrawals add to it; bills paid in cash take from it. */
  cashOnHand?: number;
  /** True once cash on hand was chosen as an income destination, even if the balance is still ₱0. */
  cashEnabled?: boolean;
  /** Debit/credit history of every bank and e-wallet balance. */
  transactions?: AccountTransaction[];
  /** Dated income deposits, including salary that changes each cutoff. */
  incomeReceipts?: IncomeReceipt[];
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
