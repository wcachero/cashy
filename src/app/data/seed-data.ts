import { monthsBetween, shiftMonth } from '../core/dates';
import { round2 } from '../core/money';
import {
  AssignedCutoff,
  BudgetSnapshot,
  CutoffAllocationItem,
  IncomeStream,
  LiabilityCategory,
  LiabilityItem,
  PaycheckCycle,
} from '../models/budget.model';

export const STORAGE_KEY = 'ph_debt_tracker_state_v2';
export const GIRLIE_ID = 'debt-girlie';
export const PLAN_ANCHOR = '2026-10-15';

const ID = {
  salary10: 'inc-1',
  salary25: 'inc-2',
  junell: 'inc-3',
  bonus: 'inc-4',
  cashAdvance: 'inc-5',
  accom: 'debt-accom',
  anapolis: 'debt-anapolis',
  bpiPersonal: 'debt-bpi-pl',
  ubPersonal: 'debt-ub-pl',
  bpiC2c: 'debt-bpi-ctc',
  rcbcInst: 'debt-rcbc-inst',
  ubInst: 'debt-ub-inst',
  cimb: 'debt-cimb-cc',
  rcbcOnce: 'debt-rcbc-bal',
  bpiCc: 'debt-bpi-cc',
  ubCc: 'debt-ub-cc',
  mayaCc: 'debt-maya-cc',
  mayaEasy: 'debt-maya-ec',
  tala: 'debt-tala',
  honey: 'debt-honey',
  moneyCat: 'debt-moneycat',
  girlie: GIRLIE_ID,
  meralco: 'exp-meralco',
  pldt: 'exp-pldt',
  groceries: 'exp-grocery',
  pocket: 'exp-pocket',
} as const;

const SALARY = 49_000;
const JUNELL = 5_000;
const BONUS = 60_000;
const CASH_ADVANCE = 5_000;
const GROCERIES = 5_500;
const POCKET = 3_000;
const MERALCO = 6_200;
const PLDT = 1_599;
const ANAPOLIS = 11_461;
const BPI_PERSONAL = 3_013;
const BPI_C2C = 14_017.17;
const UB_PERSONAL = 9_385.5;
const UB_INST = 3_306.42;
const RCBC_INST = 5_075.12;
const ACCOM = 3_000;

interface Plan {
  date: string;
  girlie?: number;
  sinking?: number;
  pocket?: number;
  honey?: boolean;
  moneyCat?: boolean;
  rcbcTopUp?: boolean;
  bpiFinish?: boolean;
}

function landReceivable() {
  return {
    id: 'recv-junell',
    name: 'Junell',
    totalDebt: JUNELL * 18,
    amountReceived: 0,
    paymentAmount: JUNELL,
    terms: 18,
    dueDayOfMonth: 30,
    borrowedOn: '2026-10-30',
    notes: 'Land sale installment. 18 months remaining, paid on the 30th and added to the 25th cutoff.',
  };
}

function incomeStreams(): IncomeStream[] {
  return [
    {
      id: ID.salary10,
      name: 'Salary (10th Cutoff)',
      amount: SALARY,
      dayOfMonth: 10,
      cutoffType: '10TH_CUTOFF',
    },
    {
      id: ID.salary25,
      name: 'Salary (25th Cutoff)',
      amount: SALARY,
      dayOfMonth: 25,
      cutoffType: '25TH_CUTOFF',
    },
    {
      id: ID.junell,
      name: 'Junell (Land Sale Installment)',
      amount: JUNELL,
      dayOfMonth: 30,
      cutoffType: '30TH_INFLOW',
      remainingMonths: 18,
    },
    {
      id: ID.bonus,
      name: '13th Month Pay Bonus',
      amount: BONUS,
      dayOfMonth: 10,
      cutoffType: 'BONUS',
      isOneTime: true,
      specificDate: '2026-12-10',
    },
    {
      id: ID.cashAdvance,
      name: 'BPI CC Cash Advance (Oct 16)',
      amount: CASH_ADVANCE,
      dayOfMonth: 16,
      cutoffType: 'CASH_ADVANCE',
      isOneTime: true,
      specificDate: '2026-10-16',
    },
  ];
}

function debt(item: LiabilityItem): LiabilityItem {
  return {
    ...item,
    bankName: item.bankName ?? item.name,
    initialBalance: item.initialBalance ?? item.totalBalance,
    originalBalance: item.originalBalance ?? item.totalBalance,
    originalTerms: item.remainingTerms,
    adjustments: item.adjustments ?? [],
  };
}

function liabilities(): LiabilityItem[] {
  return [
    debt({
      id: ID.accom,
      name: 'Accom Loan',
      bankName: 'Accom',
      category: 'FIXED_LOAN',
      totalBalance: 54000,
      monthlyAmortization: ACCOM,
      dueDayOfMonth: 16,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 18,
      startDate: '2026-10-16',
      endDate: '2028-03-16',
      status: 'ACTIVE',
      priorityRank: 1,
      notes: '18 terms, Oct 16, 2026 through Mar 16, 2028. The first payment is funded by the Oct 16 BPI cash advance.',
    }),
    debt({
      id: ID.anapolis,
      name: 'Anapolis Finance',
      bankName: 'Anapolis',
      category: 'FIXED_LOAN',
      totalBalance: 68766,
      monthlyAmortization: ANAPOLIS,
      dueDayOfMonth: 28,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 6,
      startDate: '2026-10-28',
      endDate: '2027-03-28',
      status: 'ACTIVE',
      priorityRank: 2,
      notes: 'Six terms, Oct 28, 2026 through Mar 28, 2027. Finishing unlocks ₱11,461 a month.',
    }),
    debt({
      id: ID.bpiPersonal,
      name: 'BPI Personal Loan',
      bankName: 'BPI',
      category: 'FIXED_LOAN',
      totalBalance: 81351,
      monthlyAmortization: BPI_PERSONAL,
      dueDayOfMonth: 29,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 27,
      startDate: '2026-10-29',
      endDate: '2028-12-29',
      status: 'ACTIVE',
      priorityRank: 3,
    }),
    debt({
      id: ID.ubPersonal,
      name: 'UB Personal Loan',
      bankName: 'UnionBank',
      category: 'FIXED_LOAN',
      totalBalance: 478660.5,
      monthlyAmortization: UB_PERSONAL,
      dueDayOfMonth: 15,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 51,
      startDate: '2026-11-15',
      endDate: '2031-01-15',
      status: 'SCHEDULED',
      priorityRank: 10,
      notes: '4 years and 3 months remaining. Nov 15, 2026 through Jan 15, 2031.',
    }),
    debt({
      id: ID.bpiC2c,
      name: 'BPI Credit to Cash',
      bankName: 'BPI',
      category: 'FIXED_LOAN',
      totalBalance: 672824.16,
      monthlyAmortization: BPI_C2C,
      dueDayOfMonth: 27,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 48,
      startDate: '2026-11-27',
      endDate: '2030-10-27',
      status: 'SCHEDULED',
      priorityRank: 11,
      notes: '4 years remaining. Nov 27, 2026 through Oct 27, 2030.',
    }),
    debt({
      id: ID.rcbcInst,
      name: 'RCBC CC Installment',
      bankName: 'RCBC',
      category: 'FIXED_LOAN',
      totalBalance: 91352.16,
      monthlyAmortization: RCBC_INST,
      dueDayOfMonth: 3,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 18,
      startDate: '2026-12-03',
      endDate: '2028-05-03',
      status: 'SCHEDULED',
      priorityRank: 12,
      notes: 'Starts Dec 3, 2026. 18 months.',
    }),
    debt({
      id: ID.ubInst,
      name: 'UB CC Installment',
      bankName: 'UnionBank',
      category: 'FIXED_LOAN',
      totalBalance: 19838.52,
      monthlyAmortization: UB_INST,
      dueDayOfMonth: 14,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 6,
      startDate: '2026-12-14',
      endDate: '2027-05-14',
      status: 'SCHEDULED',
      priorityRank: 13,
      notes: 'Dec 14, 2026 through May 14, 2027. Finishing unlocks ₱3,306.42 a month.',
    }),
    debt({
      id: ID.cimb,
      name: 'CIMB Credit Card',
      bankName: 'CIMB',
      category: 'REVOLVING_CC',
      totalBalance: 6088.7,
      monthlyAmortization: 0,
      minimumDue: 305,
      dueDayOfMonth: 16,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-10-16',
      endDate: '2026-11-03',
      status: 'ACTIVE',
      priorityRank: 4,
      notes: 'Pay the ₱305 minimum on Oct 16, then the ₱5,783.70 remainder on the Oct 25 cutoff.',
    }),
    debt({
      id: ID.rcbcOnce,
      name: 'RCBC CC Current Balance',
      bankName: 'RCBC',
      category: 'REVOLVING_CC',
      totalBalance: 3883.92,
      monthlyAmortization: 3883.92,
      minimumDue: 500,
      dueDayOfMonth: 3,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2026-11-03',
      endDate: '2026-11-03',
      status: 'SCHEDULED',
      priorityRank: 5,
      notes: 'One-time balance. Pay in full from the Oct 25 salary, before the Nov 3 due date.',
    }),
    debt({
      id: ID.bpiCc,
      name: 'BPI Credit Card',
      bankName: 'BPI',
      category: 'REVOLVING_CC',
      totalBalance: 50742.95,
      initialBalance: 45242.95,
      originalBalance: 50742.95,
      adjustments: [
        {
          id: 'adj-bpi-ca',
          date: '2026-10-16',
          description: 'Cash Advance ₱5,000 + ₱500 Fee',
          amountAdded: 5500,
        },
      ],
      monthlyAmortization: 0,
      minimumDue: 850,
      dueDayOfMonth: 3,
      assignedCutoff: '25TH_CUTOFF',
      startDate: '2026-11-03',
      endDate: '2027-01-10',
      status: 'ACTIVE',
      priorityRank: 6,
      notes: '₱45,242.95 base + ₱5,000 cash advance + ₱500 fee. Partial on Oct 25, major paydown on Dec 10, cleared on Jan 10.',
    }),
    debt({
      id: ID.ubCc,
      name: 'UB CC Current Balance',
      bankName: 'UnionBank',
      category: 'REVOLVING_CC',
      totalBalance: 13906.93,
      monthlyAmortization: 0,
      minimumDue: 1500,
      dueDayOfMonth: 14,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-11-14',
      endDate: '2026-12-14',
      status: 'ACTIVE',
      priorityRank: 7,
      notes: 'Pay ₱1,500 on Nov 14 to save cash for Tala, then clear the card on Dec 10.',
    }),
    debt({
      id: ID.mayaCc,
      name: 'Maya Credit Card',
      bankName: 'Maya',
      category: 'REVOLVING_CC',
      totalBalance: 5050,
      monthlyAmortization: 5050,
      minimumDue: 500,
      dueDayOfMonth: 19,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2026-11-19',
      endDate: '2026-11-19',
      status: 'ACTIVE',
      priorityRank: 8,
      notes: 'Pay in full (₱5,050) from the Nov 10 salary.',
    }),
    debt({
      id: ID.mayaEasy,
      name: 'Maya Easy Credit',
      bankName: 'Maya',
      category: 'ONE_TIME_OLA',
      totalBalance: 9905,
      monthlyAmortization: 9905,
      dueDayOfMonth: 19,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2026-11-19',
      endDate: '2026-12-19',
      status: 'ACTIVE',
      priorityRank: 9,
      notes: '₱1,500 partial on Nov 19 so Tala can be paid in full. Clear the rest on Dec 10.',
    }),
    debt({
      id: ID.tala,
      name: 'Tala Loan',
      bankName: 'Tala',
      category: 'ONE_TIME_OLA',
      totalBalance: 32555,
      monthlyAmortization: 32555,
      dueDayOfMonth: 28,
      assignedCutoff: '25TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2026-11-28',
      endDate: '2026-11-28',
      status: 'SCHEDULED',
      priorityRank: 14,
      notes: 'One-time payoff on Nov 28, funded by the Nov 10 sinking fund plus the Nov 25 salary.',
    }),
    debt({
      id: ID.honey,
      name: 'Honey Loan',
      bankName: 'Honey Loan',
      category: 'PAST_DUE_OLA',
      totalBalance: 9000,
      monthlyAmortization: 0,
      dueDayOfMonth: 10,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2027-01-10',
      endDate: '2027-01-10',
      status: 'PAST_DUE',
      priorityRank: 15,
      isFrozenPastDue: true,
      notes: 'Past due. Freeze until Jan 10, 2027, then settle the principal.',
    }),
    debt({
      id: ID.moneyCat,
      name: 'MoneyCat',
      bankName: 'MoneyCat',
      category: 'PAST_DUE_OLA',
      totalBalance: 23000,
      monthlyAmortization: 0,
      dueDayOfMonth: 10,
      assignedCutoff: '10TH_CUTOFF',
      remainingTerms: 1,
      startDate: '2027-02-10',
      endDate: '2027-02-10',
      status: 'PAST_DUE',
      priorityRank: 16,
      isFrozenPastDue: true,
      notes: 'Past due. Freeze until Feb 10, 2027, then settle the principal.',
    }),
    debt({
      id: ID.girlie,
      name: 'Girlie (Personal Debt)',
      bankName: 'Girlie',
      category: 'PERSONAL_DEBT',
      totalBalance: 220000,
      monthlyAmortization: 0,
      dueDayOfMonth: 10,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-12-10',
      endDate: '2027-10-30',
      status: 'ACTIVE',
      priorityRank: 17,
      notes: 'Official target Oct 30, 2027. This plan starts with ₱30,000 on Dec 10, 2026 and reaches ₱0 on Aug 10, 2027.',
    }),
    debt({
      id: ID.meralco,
      name: 'Meralco (Electricity)',
      bankName: 'Meralco',
      category: 'LIVING_EXPENSE',
      totalBalance: 0,
      monthlyAmortization: MERALCO,
      dueDayOfMonth: 5,
      assignedCutoff: '25TH_CUTOFF',
      startDate: '2026-11-05',
      status: 'ACTIVE',
      priorityRank: 18,
      notes: 'Range ₱5,500–₱6,200. Funded from the 25th salary and the 30th Junell installment.',
    }),
    debt({
      id: ID.pldt,
      name: 'PLDT Wifi',
      bankName: 'PLDT',
      category: 'LIVING_EXPENSE',
      totalBalance: 0,
      monthlyAmortization: PLDT,
      dueDayOfMonth: 20,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-11-20',
      status: 'ACTIVE',
      priorityRank: 19,
      notes: 'Next due Nov 20, 2026.',
    }),
    debt({
      id: ID.groceries,
      name: 'Groceries',
      bankName: 'Groceries',
      category: 'LIVING_EXPENSE',
      totalBalance: 0,
      monthlyAmortization: 11000,
      dueDayOfMonth: 10,
      assignedCutoff: 'BOTH',
      startDate: '2026-10-25',
      status: 'ACTIVE',
      priorityRank: 20,
      splitAcrossCutoffs: true,
      notes: '₱5,500 on the 10th and ₱5,500 on the 25th.',
    }),
    debt({
      id: ID.pocket,
      name: 'Pocket Money',
      bankName: 'Pocket Money',
      category: 'LIVING_EXPENSE',
      totalBalance: 0,
      monthlyAmortization: 6000,
      dueDayOfMonth: 10,
      assignedCutoff: 'BOTH',
      startDate: '2026-10-16',
      status: 'ACTIVE',
      priorityRank: 21,
      splitAcrossCutoffs: true,
      notes: '₱3,000 per cutoff. Nov 25 drops to ₱1,280.67 while saving for Tala. Oct 16 uses a ₱1,695 buffer from the cash advance.',
    }),
  ];
}

function line(
  cycleId: string,
  liabilityId: string,
  name: string,
  category: LiabilityCategory,
  dueDate: string,
  plannedAmount: number,
  extra: Partial<CutoffAllocationItem> = {},
): CutoffAllocationItem {
  const { id: suffix, ...rest } = extra;
  return {
    id: `${cycleId}:${suffix ?? liabilityId}`,
    liabilityId,
    name,
    category,
    dueDate,
    plannedAmount: round2(plannedAmount),
    actualPaidAmount: 0,
    isPaid: false,
    ...rest,
  };
}

function monthName(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
}

function cycleLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const pretty = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (iso === '2026-10-16') return `${pretty} Cash Advance`;
  if (iso === '2026-12-10') return `${pretty} Cutoff (+ 13th Month)`;
  if (date.getDate() === 25) {
    const payer = landReceivable();
    return `${pretty} Cutoff (+ ${monthName(iso)} ${payer.dueDayOfMonth} ${payer.name})`;
  }
  return `${pretty} Cutoff`;
}

function openingCycles(): PaycheckCycle[] {
  const oct16 = '2026-10-16';
  const oct25 = '2026-10-25';
  const nov10 = '2026-11-10';
  const nov25 = '2026-11-25';
  const dec10 = '2026-12-10';
  const dec25 = '2026-12-25';

  return [
    {
      id: oct16,
      label: cycleLabel(oct16),
      cutoffDate: oct16,
      baseIncome: CASH_ADVANCE,
      supplementaryIncome: 0,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [
        line(oct16, ID.accom, 'Accom Loan', 'FIXED_LOAN', oct16, ACCOM, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/18. Funded by the BPI cash advance. Balance falls to ₱51,000.',
        }),
        line(oct16, ID.cimb, 'CIMB Credit Card', 'REVOLVING_CC', oct16, 305, {
          minimumDue: 305,
          countsAsTerm: false,
          paymentNote: 'Minimum due. The ₱5,783.70 remainder is on the Oct 25 cutoff.',
        }),
        line(oct16, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', oct16, 1695, {
          paymentNote: 'Immediate pocket buffer for Oct 16–24.',
        }),
      ],
    },
    {
      id: oct25,
      label: cycleLabel(oct25),
      cutoffDate: oct25,
      baseIncome: SALARY,
      supplementaryIncome: JUNELL,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [
        line(oct25, ID.groceries, 'Groceries', 'LIVING_EXPENSE', oct25, GROCERIES),
        line(oct25, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', oct25, POCKET),
        line(oct25, ID.anapolis, 'Anapolis Finance', 'FIXED_LOAN', '2026-10-28', ANAPOLIS, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/6',
        }),
        line(oct25, ID.bpiPersonal, 'BPI Personal Loan', 'FIXED_LOAN', '2026-10-29', BPI_PERSONAL, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/27',
        }),
        line(oct25, ID.rcbcOnce, 'RCBC CC Current Balance', 'REVOLVING_CC', '2026-11-03', 3883.92, {
          countsAsTerm: true,
          paymentNote: 'Paid in full before the Nov 3 due date',
        }),
        line(oct25, ID.cimb, 'CIMB Credit Card', 'REVOLVING_CC', '2026-11-03', 5783.7, {
          paymentNote: 'Remainder after the ₱305 minimum due on Oct 16. Paid in full.',
        }),
        line(oct25, ID.meralco, 'Meralco (Electricity)', 'LIVING_EXPENSE', '2026-11-05', MERALCO, {
          paymentNote: 'Due Nov 5. Funded from the Oct 25 salary and the Oct 30 Junell installment.',
        }),
        line(oct25, ID.bpiCc, 'BPI Credit Card', 'REVOLVING_CC', '2026-11-03', 15158.38, {
          countsAsTerm: false,
          paymentNote: 'Partial paydown. Balance falls from ₱50,742.95 to ₱35,584.57.',
        }),
      ],
    },
    {
      id: nov10,
      label: cycleLabel(nov10),
      cutoffDate: nov10,
      baseIncome: SALARY,
      supplementaryIncome: 0,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 18465.5,
      allocations: [
        line(nov10, ID.groceries, 'Groceries', 'LIVING_EXPENSE', nov10, GROCERIES),
        line(nov10, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', nov10, POCKET),
        line(nov10, ID.ubPersonal, 'UB Personal Loan', 'FIXED_LOAN', '2026-11-15', UB_PERSONAL, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/51',
        }),
        line(nov10, ID.accom, 'Accom Loan', 'FIXED_LOAN', '2026-11-16', ACCOM, {
          countsAsTerm: true,
          paymentNote: 'Installment 2/18',
        }),
        line(nov10, ID.mayaCc, 'Maya Credit Card', 'REVOLVING_CC', '2026-11-19', 5050, {
          countsAsTerm: true,
          paymentNote: 'Paid in full',
        }),
        line(nov10, ID.pldt, 'PLDT Wifi', 'LIVING_EXPENSE', '2026-11-20', PLDT),
        line(nov10, ID.ubCc, 'UB CC Current Balance', 'REVOLVING_CC', '2026-11-14', 1500, {
          minimumDue: 1500,
          countsAsTerm: false,
          paymentNote: 'Minimum/partial. The rest waits so Tala can be paid in full.',
        }),
        line(nov10, ID.mayaEasy, 'Maya Easy Credit', 'ONE_TIME_OLA', '2026-11-19', 1500, {
          countsAsTerm: false,
          paymentNote: 'Partial rollover. Preserves cash for Tala.',
        }),
      ],
    },
    {
      id: nov25,
      label: cycleLabel(nov25),
      cutoffDate: nov25,
      baseIncome: SALARY,
      supplementaryIncome: JUNELL,
      carryOverFromPrevious: 18465.5,
      sinkingFundReserved: 0,
      allocations: [
        line(nov25, ID.groceries, 'Groceries', 'LIVING_EXPENSE', nov25, GROCERIES),
        line(nov25, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', nov25, 1280.67, {
          paymentNote: 'Tight month. Pocket money reduced from ₱3,000 to ₱1,280.67.',
        }),
        line(nov25, ID.bpiC2c, 'BPI Credit to Cash', 'FIXED_LOAN', '2026-11-27', BPI_C2C, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/48',
        }),
        line(nov25, ID.tala, 'Tala Loan', 'ONE_TIME_OLA', '2026-11-28', 32555, {
          countsAsTerm: true,
          paymentNote: 'Paid in full from the Nov 10 sinking fund and this salary.',
        }),
        line(nov25, ID.anapolis, 'Anapolis Finance', 'FIXED_LOAN', '2026-11-28', ANAPOLIS, {
          countsAsTerm: true,
          paymentNote: 'Installment 2/6',
        }),
        line(nov25, ID.bpiPersonal, 'BPI Personal Loan', 'FIXED_LOAN', '2026-11-29', BPI_PERSONAL, {
          countsAsTerm: true,
          paymentNote: 'Installment 2/27',
        }),
        line(nov25, ID.meralco, 'Meralco (Electricity)', 'LIVING_EXPENSE', '2026-12-05', 4638.66, {
          paymentNote: 'Partial reserve for the Dec 5 bill. The ₱1,561.34 remainder is on Dec 10.',
        }),
      ],
    },
    {
      id: dec10,
      label: cycleLabel(dec10),
      cutoffDate: dec10,
      baseIncome: SALARY,
      supplementaryIncome: BONUS,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [
        line(dec10, ID.groceries, 'Groceries', 'LIVING_EXPENSE', dec10, GROCERIES),
        line(dec10, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', dec10, POCKET),
        line(dec10, ID.rcbcInst, 'RCBC CC Installment', 'FIXED_LOAN', '2026-12-03', RCBC_INST, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/18',
        }),
        line(dec10, ID.meralco, 'Meralco (Electricity)', 'LIVING_EXPENSE', '2026-12-05', 1561.34, {
          paymentNote: 'Remainder of the Dec 5 bill after the Nov 25 partial.',
        }),
        line(dec10, ID.ubCc, 'UB CC Current Balance', 'REVOLVING_CC', '2026-12-14', 12800, {
          paymentNote: 'Paid in full, including about ₱400 interest.',
        }),
        line(dec10, ID.ubInst, 'UB CC Installment', 'FIXED_LOAN', '2026-12-14', UB_INST, {
          countsAsTerm: true,
          paymentNote: 'Installment 1/6',
        }),
        line(dec10, ID.ubPersonal, 'UB Personal Loan', 'FIXED_LOAN', '2026-12-15', UB_PERSONAL, {
          countsAsTerm: true,
          paymentNote: 'Installment 2/51',
        }),
        line(dec10, ID.accom, 'Accom Loan', 'FIXED_LOAN', '2026-12-16', ACCOM, {
          countsAsTerm: true,
          paymentNote: 'Installment 3/18',
        }),
        line(dec10, ID.mayaEasy, 'Maya Easy Credit', 'ONE_TIME_OLA', '2026-12-19', 8800, {
          countsAsTerm: true,
          paymentNote: 'Paid in full.',
        }),
        line(dec10, ID.pldt, 'PLDT Wifi', 'LIVING_EXPENSE', '2026-12-20', PLDT),
        line(dec10, ID.bpiCc, 'BPI Credit Card', 'REVOLVING_CC', '2026-12-03', 24972.62, {
          countsAsTerm: false,
          paymentNote: 'Major paydown. Balance falls from ₱35,584.57 to ₱10,611.95.',
        }),
        line(dec10, ID.girlie, 'Girlie (Personal Debt)', 'PERSONAL_DEBT', dec10, 30000, {
          paymentNote: 'Payment 1. ₱220,000 falls to ₱190,000.',
        }),
      ],
    },
    {
      id: dec25,
      label: cycleLabel(dec25),
      cutoffDate: dec25,
      baseIncome: SALARY,
      supplementaryIncome: JUNELL,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [
        line(dec25, ID.groceries, 'Groceries', 'LIVING_EXPENSE', dec25, GROCERIES),
        line(dec25, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', dec25, POCKET),
        line(dec25, ID.bpiC2c, 'BPI Credit to Cash', 'FIXED_LOAN', '2026-12-27', BPI_C2C, {
          countsAsTerm: true,
          paymentNote: 'Installment 2/48',
        }),
        line(dec25, ID.anapolis, 'Anapolis Finance', 'FIXED_LOAN', '2026-12-28', ANAPOLIS, {
          countsAsTerm: true,
          paymentNote: 'Installment 3/6',
        }),
        line(dec25, ID.bpiPersonal, 'BPI Personal Loan', 'FIXED_LOAN', '2026-12-29', BPI_PERSONAL, {
          countsAsTerm: true,
          paymentNote: 'Installment 3/27',
        }),
        line(dec25, ID.bpiCc, 'BPI Credit Card', 'REVOLVING_CC', '2027-01-03', 6800, {
          countsAsTerm: false,
          paymentNote: 'Paydown toward Jan 3. Leaves ₱3,811.95, cleared on Jan 10.',
        }),
        line(dec25, ID.meralco, 'Meralco (Electricity)', 'LIVING_EXPENSE', '2027-01-05', MERALCO, {
          paymentNote: 'Part of the ₱10,208.83 reserve for early-January bills.',
        }),
        line(dec25, ID.rcbcInst, 'RCBC CC Installment', 'FIXED_LOAN', '2027-01-03', 4008.83, {
          id: 'reserve',
          countsAsTerm: false,
          paymentNote: 'Partial reserve for installment 2/18. The ₱1,066.29 top-up is on Jan 10.',
        }),
      ],
    },
  ];
}

function make2027Cycle(plan: Plan, carry: number): PaycheckCycle {
  const is25 = plan.date.endsWith('-25');
  const allocations: CutoffAllocationItem[] = [
    line(plan.date, ID.groceries, 'Groceries', 'LIVING_EXPENSE', plan.date, GROCERIES),
    line(plan.date, ID.pocket, 'Pocket Money', 'LIVING_EXPENSE', plan.date, plan.pocket ?? POCKET),
  ];

  if (is25) {
    const bpiPersonalTerm = monthsBetween('2026-10-25', plan.date) + 1;
    const c2cTerm = monthsBetween('2026-11-25', plan.date) + 1;
    allocations.push(
      line(plan.date, ID.bpiC2c, 'BPI Credit to Cash', 'FIXED_LOAN', shiftMonth(plan.date, 0, 27), BPI_C2C, {
        countsAsTerm: true,
        paymentNote: `Installment ${c2cTerm}/48`,
      }),
    );
    if (plan.date <= '2027-03-25') {
      const term = monthsBetween('2026-10-25', plan.date) + 1;
      allocations.push(
        line(plan.date, ID.anapolis, 'Anapolis Finance', 'FIXED_LOAN', shiftMonth(plan.date, 0, 28), ANAPOLIS, {
          countsAsTerm: true,
          paymentNote: term === 6 ? 'Final installment 6/6. Unlocks ₱11,461 a month.' : `Installment ${term}/6`,
        }),
      );
    }
    allocations.push(
      line(plan.date, ID.bpiPersonal, 'BPI Personal Loan', 'FIXED_LOAN', shiftMonth(plan.date, 0, 29), BPI_PERSONAL, {
        countsAsTerm: true,
        paymentNote: `Installment ${bpiPersonalTerm}/27`,
      }),
      line(plan.date, ID.rcbcInst, 'RCBC CC Installment', 'FIXED_LOAN', shiftMonth(plan.date, 1, 3), RCBC_INST, {
        countsAsTerm: true,
        paymentNote: `Installment ${monthsBetween('2026-12-03', shiftMonth(plan.date, 1, 3)) + 1}/18`,
      }),
      line(plan.date, ID.meralco, 'Meralco (Electricity)', 'LIVING_EXPENSE', shiftMonth(plan.date, 1, 5), MERALCO),
    );
  } else {
    if (plan.rcbcTopUp) {
      allocations.push(
        line(plan.date, ID.rcbcInst, 'RCBC CC Installment', 'FIXED_LOAN', '2027-01-03', 1066.29, {
          id: 'topup',
          countsAsTerm: true,
          paymentNote: 'Top-up that completes installment 2/18 after the Dec 25 reserve.',
        }),
      );
    }
    if (plan.honey) {
      allocations.push(
        line(plan.date, ID.honey, 'Honey Loan', 'PAST_DUE_OLA', '2027-01-10', 9000, {
          countsAsTerm: true,
          paymentNote: 'Past-due principal settlement.',
        }),
      );
    }
    if (plan.date <= '2027-05-10') {
      const term = monthsBetween('2026-12-10', plan.date) + 1;
      allocations.push(
        line(plan.date, ID.ubInst, 'UB CC Installment', 'FIXED_LOAN', shiftMonth(plan.date, 0, 14), UB_INST, {
          countsAsTerm: true,
          paymentNote: term === 6 ? 'Final installment 6/6. Unlocks ₱3,306.42 a month.' : `Installment ${term}/6`,
        }),
      );
    }
    const ubTerm = monthsBetween('2026-11-10', plan.date) + 1;
    const accomTerm = monthsBetween('2026-10-10', plan.date) + 1;
    allocations.push(
      line(plan.date, ID.ubPersonal, 'UB Personal Loan', 'FIXED_LOAN', shiftMonth(plan.date, 0, 15), UB_PERSONAL, {
        countsAsTerm: true,
        paymentNote: `Installment ${ubTerm}/51`,
      }),
      line(plan.date, ID.accom, 'Accom Loan', 'FIXED_LOAN', shiftMonth(plan.date, 0, 16), ACCOM, {
        countsAsTerm: true,
        paymentNote: `Installment ${accomTerm}/18`,
      }),
    );
    if (plan.moneyCat) {
      allocations.push(
        line(plan.date, ID.moneyCat, 'MoneyCat', 'PAST_DUE_OLA', '2027-02-10', 23000, {
          countsAsTerm: true,
          paymentNote: 'Past-due principal settlement.',
        }),
      );
    }
    allocations.push(line(plan.date, ID.pldt, 'PLDT Wifi', 'LIVING_EXPENSE', shiftMonth(plan.date, 0, 20), PLDT));
    if (plan.bpiFinish) {
      allocations.push(
        line(plan.date, ID.bpiCc, 'BPI Credit Card', 'REVOLVING_CC', '2027-01-10', 3811.95, {
          paymentNote: 'Clears the ₱3,811.95 left after the Dec 25 paydown.',
        }),
      );
    }
    if (plan.girlie) {
      allocations.push(
        line(plan.date, ID.girlie, 'Girlie (Personal Debt)', 'PERSONAL_DEBT', plan.date, plan.girlie, {
          paymentNote:
            plan.date === '2027-08-10'
              ? 'Final payoff. Girlie reaches ₱0 on Aug 10, 2027, ahead of the Oct 30, 2027 goal.'
              : plan.honey
                ? 'Smaller payment so Honey Loan and the BPI card can be cleared on this cutoff.'
                : plan.moneyCat
                  ? 'Limited to the cash left after the MoneyCat settlement.'
                  : 'Principal payment toward the August 2027 payoff.',
        }),
      );
    }
  }

  return {
    id: plan.date,
    label: cycleLabel(plan.date),
    cutoffDate: plan.date,
    baseIncome: SALARY,
    supplementaryIncome: is25 ? JUNELL : 0,
    carryOverFromPrevious: round2(carry),
    sinkingFundReserved: round2(plan.sinking ?? 0),
    allocations,
  };
}

function futureCycles(): PaycheckCycle[] {
  const plans: Plan[] = [
    { date: '2027-01-10', girlie: 9330.84, honey: true, rcbcTopUp: true, bpiFinish: true },
    { date: '2027-01-25', sinking: 5733.71 },
    { date: '2027-02-10', girlie: 5942.79, moneyCat: true },
    { date: '2027-02-25', sinking: 5733.71 },
    { date: '2027-03-10', girlie: 28942.79 },
    { date: '2027-03-25', sinking: 5733.71 },
    { date: '2027-04-10', girlie: 28942.79 },
    { date: '2027-04-25', sinking: 6790.92 },
    { date: '2027-05-10', girlie: 30000 },
    { date: '2027-05-25', sinking: 3484.5 },
    { date: '2027-06-10', girlie: 30000 },
    { date: '2027-06-25', sinking: 3484.5 },
    { date: '2027-07-10', girlie: 30000 },
    { date: '2027-07-25', sinking: 325.29 },
    { date: '2027-08-10', girlie: 26840.79 },
    { date: '2027-08-25' },
    { date: '2027-09-10' },
    { date: '2027-09-25' },
    { date: '2027-10-10' },
    { date: '2027-10-25' },
  ];

  let carry = 0;
  return plans.map((plan) => {
    const cycle = make2027Cycle(plan, carry);
    carry = cycle.sinkingFundReserved;
    return cycle;
  });
}

function assertPlan(cycles: PaycheckCycle[]): void {
  if (cycles.length !== 26) {
    throw new Error(`Expected 26 paycheck cycles, received ${cycles.length}.`);
  }
  if (cycles[0]?.id !== '2026-10-16' || cycles.at(-1)?.id !== '2027-10-25') {
    throw new Error('Paycheck timeline must run from Oct 16, 2026 through Oct 25, 2027.');
  }

  let girlie = 0;
  for (let index = 0; index < cycles.length; index += 1) {
    const cycle = cycles[index];
    const planned = round2(cycle.allocations.reduce((sum, item) => sum + item.plannedAmount, 0));
    const inflow = round2(cycle.baseIncome + cycle.supplementaryIncome + cycle.carryOverFromPrevious);
    const unallocated = round2(inflow - planned - cycle.sinkingFundReserved);
    if (unallocated < -0.02) {
      throw new Error(`${cycle.id} is overdrawn by ${Math.abs(unallocated).toFixed(2)}.`);
    }
    if (index > 0 && Math.abs(cycle.carryOverFromPrevious - cycles[index - 1].sinkingFundReserved) > 0.02) {
      throw new Error(`${cycle.id} carry-over does not match the previous sinking fund.`);
    }
    girlie = round2(
      girlie +
        cycle.allocations
          .filter((item) => item.liabilityId === ID.girlie)
          .reduce((sum, item) => sum + item.plannedAmount, 0),
    );
  }

  if (Math.abs(girlie - 220000) > 0.02) {
    throw new Error(`Girlie allocations total ${girlie}, not 220000.`);
  }

  const plannedOf = (cycle: PaycheckCycle) =>
    round2(cycle.allocations.reduce((sum, item) => sum + item.plannedAmount, 0));
  if (Math.abs(plannedOf(cycles[0]) - 5000) > 0.02) throw new Error('Oct 16 allocations must equal ₱5,000.');
  if (Math.abs(plannedOf(cycles[1]) - 54000) > 0.02) throw new Error('Oct 25 allocations must equal ₱54,000.');
  if (Math.abs(cycles[2].sinkingFundReserved - 18465.5) > 0.02) throw new Error('Nov 10 reserve must be ₱18,465.50.');
  if (Math.abs(cycles[3].sinkingFundReserved) > 0.02) throw new Error('Nov 25 reserve must be ₱0.');
  const decemberInflow = cycles[4].baseIncome + cycles[4].supplementaryIncome + cycles[4].carryOverFromPrevious;
  if (Math.abs(decemberInflow - 109000) > 0.02) throw new Error('Dec 10 inflow must be ₱109,000.');
}

export function createSeedSnapshot(): BudgetSnapshot {
  const cycles = [...openingCycles(), ...futureCycles()];
  assertPlan(cycles);
  return {
    version: 1,
    incomeStreams: incomeStreams(),
    liabilities: liabilities(),
    paycheckCycles: cycles,
    notificationsEnabled: false,
    bankSavings: [],
    receivables: [landReceivable()],
  };
}

export function cloneSnapshot(snapshot: BudgetSnapshot = createSeedSnapshot()): BudgetSnapshot {
  return structuredClone(snapshot);
}

export function dueDateForCutoff(cutoffDate: string, dueDay: number, cutoff: AssignedCutoff): string {
  if (cutoff === 'BOTH') return cutoffDate;
  if (cutoff === '10TH_CUTOFF') return shiftMonth(cutoffDate, 0, dueDay);
  if (dueDay >= 25) return shiftMonth(cutoffDate, 0, dueDay);
  return shiftMonth(cutoffDate, 1, dueDay);
}
