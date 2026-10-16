import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CATEGORY_META, cutoffDays, defaultCutoff } from '../core/categories';
import { daysBetween, formatLongDate, formatMonthYear, formatShortDate, matchesCutoffDays, ordinalDay, parseIsoDate, shiftMonth, today, todayIso, toIso } from '../core/dates';
import { snapshotFromImport } from '../core/finance-export';
import { formatPhp, round2 } from '../core/money';
import { GIRLIE_ID, cloneSnapshot, dueDateForCutoff } from '../data/seed-data';
import { AuthService } from './auth.service';
import {
  ACCOUNT_KIND_LABEL,
  AccountTransaction,
  AllocationPaymentShare,
  AssignedCutoff,
  CASH_DEPOSIT_ID,
  BankSaving,
  BudgetSnapshot,
  CutoffAllocationItem,
  CutoffWithdrawal,
  DebtSlice,
  FreeCashStep,
  IncomeReceipt,
  IncomeStream,
  ItemStatus,
  LiabilityCategory,
  LiabilityItem,
  Milestone,
  MoneyAccount,
  PaycheckCycle,
  PaymentMethod,
  Receivable,
  ReceivablePayment,
  SharedExpense,
  SharedExpenseShare,
  UpcomingDue,
} from '../models/budget.model';

const DEBT_CATEGORIES: LiabilityCategory[] = [
  'REVOLVING_CC',
  'ONE_TIME_OLA',
  'PAST_DUE_OLA',
  'FIXED_LOAN',
  'PERSONAL_DEBT',
];

export interface CutoffIncomeLine {
  id: string;
  name: string;
  amount: number;
  kind: 'salary' | 'owe' | 'other' | 'carry';
  /** Set when the actual salary received differs from what was expected. */
  expected?: number;
  /** Bank or e-wallet this money lands in, when one is linked. */
  accountId?: string;
}

export interface LiabilityDraft {
  name: string;
  bankName?: string;
  category: LiabilityCategory;
  totalBalance: number;
  monthlyAmortization: number;
  minimumDue?: number;
  dueDayOfMonth: number;
  assignedCutoff?: AssignedCutoff;
  remainingTerms?: number;
  startDate: string;
  endDate?: string;
  status?: ItemStatus;
  notes?: string;
  splitAcrossCutoffs?: boolean;
  addToFutureCutoffs?: boolean;
}

@Injectable({ providedIn: 'root' })
export class BudgetStateService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly seeded = cloneSnapshot();
  private acceptSaves = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;

  readonly incomeStreams = signal<IncomeStream[]>(this.seeded.incomeStreams);
  readonly liabilities = signal<LiabilityItem[]>(this.seeded.liabilities);
  readonly paycheckCycles = signal<PaycheckCycle[]>(this.seeded.paycheckCycles);
  readonly notificationsEnabled = signal(this.seeded.notificationsEnabled);
  readonly hideDebtTotal = signal(Boolean(this.seeded.hideDebtTotal));
  readonly hideSavingsTotal = signal(Boolean(this.seeded.hideSavingsTotal));
  readonly bankSavings = signal<BankSaving[]>(this.seeded.bankSavings ?? []);
  readonly receivables = signal<Receivable[]>(this.seeded.receivables ?? []);
  readonly withdrawals = signal<CutoffWithdrawal[]>(this.seeded.withdrawals ?? []);
  readonly sharedExpenses = signal<SharedExpense[]>(this.seeded.sharedExpenses ?? []);
  readonly accounts = signal<MoneyAccount[]>(this.seeded.accounts ?? []);
  readonly cashOnHand = signal(round2(Math.max(0, this.seeded.cashOnHand ?? 0)));
  readonly cashEnabled = signal(Boolean(this.seeded.cashEnabled));
  readonly transactions = signal<AccountTransaction[]>(this.seeded.transactions ?? []);
  readonly incomeReceipts = signal<IncomeReceipt[]>(this.seeded.incomeReceipts ?? []);
  readonly loaded = signal(false);
  readonly saveError = signal('');
  private lastSettledOn = '';

  /** Balances recorded in banks and e-wallets, not counting cash on hand. */
  readonly otherBankSavings = computed(() => round2(this.bankSavings().reduce((sum, item) => sum + Math.max(0, item.amount), 0)));

  /** Everything you hold: bank and e-wallet balances plus cash on hand. */
  readonly totalSavings = computed(() => round2(this.otherBankSavings() + this.cashOnHand()));

  /** A bank, e-wallet, or cash on hand exists so income has somewhere to land. */
  readonly hasDepositSource = computed(
    () =>
      this.accounts().length > 0 ||
      this.cashEnabled() ||
      this.cashOnHand() > 0 ||
      this.incomeStreams().some((stream) => stream.accountId === CASH_DEPOSIT_ID),
  );

  readonly totalOwedToYou = computed(() =>
    round2(this.receivables().reduce((sum, item) => sum + Math.max(0, item.totalDebt - item.amountReceived), 0)),
  );

  readonly debtLiabilities = computed(() =>
    this.liabilities().filter((item) => item.category !== 'LIVING_EXPENSE' && item.status !== 'PAID'),
  );

  readonly totalDebtRemaining = computed(() =>
    round2(this.debtLiabilities().reduce((sum, item) => sum + Math.max(0, item.totalBalance), 0)),
  );

  readonly totalDebtOriginal = computed(() =>
    round2(
      this.liabilities()
        .filter((item) => item.category !== 'LIVING_EXPENSE')
        .reduce((sum, item) => sum + Math.max(item.originalBalance ?? item.totalBalance, item.totalBalance, 0), 0),
    ),
  );

  readonly debtPaidPercent = computed(() => {
    const original = this.totalDebtOriginal();
    if (original <= 0) return 0;
    return Math.min(100, Math.max(0, ((original - this.totalDebtRemaining()) / original) * 100));
  });

  readonly girlie = computed(
    () => this.liabilities().find((item) => item.id === GIRLIE_ID) ?? this.liabilities().find((item) => item.category === 'PERSONAL_DEBT') ?? null,
  );

  readonly girliePaid = computed(() => {
    const item = this.girlie();
    if (!item) return 0;
    return round2(Math.max(0, (item.originalBalance ?? item.totalBalance) - item.totalBalance));
  });

  readonly girliePercent = computed(() => {
    const item = this.girlie();
    const original = item?.originalBalance ?? item?.totalBalance ?? 0;
    if (!item || original <= 0) return 0;
    return Math.min(100, Math.max(0, (this.girliePaid() / original) * 100));
  });

  readonly girliePayoffDate = computed(() => {
    const item = this.girlie();
    if (!item) return null;
    if (item.totalBalance <= 0) return 'Paid off';
    let covered = 0;
    for (const cycle of this.paycheckCycles()) {
      for (const allocation of cycle.allocations) {
        if (allocation.liabilityId !== item.id || allocation.isPaid) continue;
        covered = round2(covered + allocation.plannedAmount);
        if (covered + 0.01 >= item.totalBalance) return cycle.cutoffDate;
      }
    }
    return item.endDate ?? null;
  });

  readonly planSummary = computed(() => describePlan(this.incomeStreams(), this.receivables(), this.liabilities()));

  readonly monthlyIncome = computed(() => monthlyIncomeOn(this.incomeStreams(), todayIso()));

  readonly monthlyFixedObligations = computed(() =>
    round2(
      this.liabilities()
        .filter((item) => item.status !== 'PAID' && (item.category === 'LIVING_EXPENSE' || item.category === 'FIXED_LOAN') && activeInMonth(item, todayIso()))
        .reduce((sum, item) => sum + item.monthlyAmortization, 0),
    ),
  );

  readonly monthlyFreeCashFlow = computed(() => round2(this.monthlyIncome() - this.monthlyFixedObligations()));

  readonly freeCashSteps = computed<FreeCashStep[]>(() => {
    const streams = this.incomeStreams();
    const tracked = this.liabilities().filter(
      (item) => item.status !== 'PAID' && (item.category === 'LIVING_EXPENSE' || item.category === 'FIXED_LOAN'),
    );
    const amountFor = (onDate: string) =>
      round2(
        monthlyIncomeOn(streams, onDate) -
          tracked.filter((item) => activeInMonth(item, onDate)).reduce((sum, item) => sum + item.monthlyAmortization, 0),
      );
    const today = todayIso();
    const notes = new Map<string, string[]>();
    const add = (iso: string, note: string) => {
      const key = `${iso.slice(0, 7)}-01`;
      if (key <= today.slice(0, 7)) return;
      const list = notes.get(key) ?? [];
      list.push(note);
      notes.set(key, list);
    };
    for (const item of tracked) {
      if (item.startDate.slice(0, 7) > today.slice(0, 7)) add(item.startDate, `${item.name} starts`);
      const end = item.endDate ?? termEnd(item);
      if (end) add(shiftMonth(end, 1, 1), `${item.name} finished`);
    }
    for (const stream of streams) {
      const months = stream.remainingMonths ?? 0;
      if (stream.cutoffType === '30TH_INFLOW' && months > 0) {
        const last = shiftMonth(today, months - 1, stream.dayOfMonth);
        add(shiftMonth(last, 1, 1), `${stream.name} ends`);
      }
    }
    const steps: FreeCashStep[] = [
      { label: 'Now', detail: 'Living costs and loans active this month', amount: amountFor(today) },
    ];
    for (const [iso, list] of [...notes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const amount = amountFor(iso);
      const previous = steps.at(-1);
      if (previous && previous.label !== 'Now' && previous.amount === amount) {
        previous.detail = `${previous.detail}. ${list.join(', ')}`;
        previous.label = formatMonthYear(iso);
        continue;
      }
      steps.push({ label: formatMonthYear(iso), detail: list.join(', '), amount });
    }
    return steps;
  });

  readonly debtMix = computed<DebtSlice[]>(() => {
    const total = this.totalDebtRemaining();
    return DEBT_CATEGORIES.map((category) => {
      const amount = round2(
        this.debtLiabilities().filter((item) => item.category === category).reduce((sum, item) => sum + item.totalBalance, 0),
      );
      return {
        category,
        label: CATEGORY_META[category].label,
        amount,
        percent: total > 0 ? (amount / total) * 100 : 0,
        barClass: CATEGORY_META[category].barClass,
      };
    }).filter((slice) => slice.amount > 0);
  });

  readonly upcomingDues = computed<UpcomingDue[]>(() => {
    const anchor = today();
    return this.liabilities()
      .filter((item) => item.status !== 'PAID' && item.status !== 'PAST_DUE' && item.category !== 'PERSONAL_DEBT')
      .map((item) => {
        const dueDate = this.nextDueDate(item, anchor);
        return {
          liabilityId: item.id,
          name: item.name,
          category: item.category,
          dueDate,
          daysUntil: daysBetween(anchor, parseIsoDate(dueDate)),
          suggestedAmount: this.suggestedPayment(item),
          fullBalance: item.totalBalance,
          minimumDue: item.minimumDue,
        };
      })
      .filter((due) => due.daysUntil >= 0 && due.daysUntil <= 7 && (due.suggestedAmount > 0 || due.fullBalance > 0))
      .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  });

  readonly pastDueLiabilities = computed(() =>
    this.liabilities().filter((item) => item.status === 'PAST_DUE' && item.totalBalance > 0),
  );

  readonly upcomingCycle = computed(() => {
    const iso = todayIso();
    const cycles = this.paycheckCycles();
    return cycles.find((cycle) => cycle.cutoffDate >= iso) ?? cycles.at(-1) ?? null;
  });

  readonly milestones = computed<Milestone[]>(() => {
    const debts = this.liabilities().filter((item) => item.category !== 'LIVING_EXPENSE' && item.category !== 'REVOLVING_CC');
    const cards = this.liabilities().filter((item) => item.category === 'REVOLVING_CC');
    const milestones: Milestone[] = [];
    for (const item of debts) {
      const date = this.payoffDate(item);
      if (!date) continue;
      const target = item.endDate && item.endDate !== date ? ` Target ${formatLongDate(item.endDate)}.` : '';
      const original = item.originalBalance ?? item.totalBalance;
      const detail =
        item.category === 'FIXED_LOAN' && item.monthlyAmortization > 0
          ? `${formatPhp(item.monthlyAmortization)} a month comes back after ${formatLongDate(date)}.${target}`
          : `${formatPhp(original)} reaches zero on ${formatLongDate(date)}.${target}`;
      milestones.push({
        id: item.id,
        date,
        title: `${item.name} ${item.category === 'FIXED_LOAN' ? 'finishes' : 'paid off'}`,
        detail,
        done: item.totalBalance <= 0 || item.status === 'PAID',
      });
    }
    if (cards.length) {
      const dates = cards.map((item) => this.payoffDate(item)).filter((date): date is string => !!date);
      const date = dates.sort()[dates.length - 1];
      if (date) {
        const names = cards.map((item) => item.bankName || item.name).join(', ');
        milestones.push({
          id: 'revolving-cards',
          date,
          title: 'Credit cards reach zero',
          detail: `${names} clear by ${formatLongDate(date)}.`,
          done: cards.every((item) => item.totalBalance <= 0 || item.status === 'PAID'),
        });
      }
    }
    return milestones.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  });

  constructor() {
    effect(() => {
      const snapshot = this.exportSnapshot();
      if (!this.acceptSaves) return;
      this.queueSave(snapshot);
    });
    // Deposits land on the day a cutoff arrives, even when the tab stays open past midnight.
    if (typeof window !== 'undefined') {
      setInterval(() => {
        if (this.acceptSaves) this.settleArrivedDeposits();
      }, 60_000);
    }
  }

  async hydrate(): Promise<void> {
    this.acceptSaves = false;
    const snapshot = await firstValueFrom(this.http.get<BudgetSnapshot>('/api/plan', { headers: this.auth.headers() }));
    this.applySnapshot(snapshot);
    this.loaded.set(true);
    this.acceptSaves = true;
    this.saveError.set('');
    this.ensureCurrentMonthCutoffs();
    this.settleArrivedDeposits();
  }

  pauseSaves(): void {
    this.acceptSaves = false;
    this.loaded.set(false);
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  private queueSave(snapshot: BudgetSnapshot): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.sendSave(snapshot), 400);
  }

  flushSave(): void {
    if (!this.acceptSaves) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.sendSave(this.exportSnapshot());
  }

  private sendSave(snapshot: BudgetSnapshot): void {
    const payload: BudgetSnapshot = { ...snapshot, revision: ++this.revision };
    void firstValueFrom(this.http.put('/api/plan', payload, { headers: this.auth.headers() }))
      .then(() => this.saveError.set(''))
      .catch((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 409) return;
        this.saveError.set('Could not save to SQLite. Leave this page open and check that the API is running.');
      });
  }

  private applySnapshot(snapshot: BudgetSnapshot): void {
    this.incomeStreams.set(snapshot.incomeStreams);
    this.liabilities.set(snapshot.liabilities);
    this.paycheckCycles.set(snapshot.paycheckCycles);
    this.notificationsEnabled.set(Boolean(snapshot.notificationsEnabled));
    this.bankSavings.set(snapshot.bankSavings ?? []);
    this.receivables.set(snapshot.receivables ?? []);
    this.withdrawals.set(snapshot.withdrawals ?? []);
    this.sharedExpenses.set(snapshot.sharedExpenses ?? []);
    this.accounts.set(snapshot.accounts ?? []);
    this.cashOnHand.set(round2(Math.max(0, snapshot.cashOnHand ?? 0)));
    this.cashEnabled.set(Boolean(snapshot.cashEnabled) || (snapshot.cashOnHand ?? 0) > 0);
    this.transactions.set(snapshot.transactions ?? []);
    this.incomeReceipts.set(snapshot.incomeReceipts ?? []);
    this.lastSettledOn = '';
    if (typeof snapshot.hideDebtTotal === 'boolean') this.hideDebtTotal.set(snapshot.hideDebtTotal);
    if (typeof snapshot.hideSavingsTotal === 'boolean') this.hideSavingsTotal.set(snapshot.hideSavingsTotal);
    if (typeof snapshot.revision === 'number' && snapshot.revision > this.revision) this.revision = snapshot.revision;
  }

  /** Salary for this cutoff: what was actually received once logged, otherwise the expected amount. */
  cycleBaseReceived(cycle: PaycheckCycle): number {
    return cycle.actualIncome != null ? cycle.actualIncome : cycle.baseIncome;
  }

  cycleInflow(cycle: PaycheckCycle): number {
    return round2(this.cycleBaseReceived(cycle) + cycle.supplementaryIncome + cycle.carryOverFromPrevious);
  }

  cycleExpectedInflow(cycle: PaycheckCycle): number {
    return round2(cycle.baseIncome + cycle.supplementaryIncome + cycle.carryOverFromPrevious);
  }

  /** What is left of this cutoff's money after bills ticked paid and cash withdrawn from it. */
  cycleRemaining(cycle: PaycheckCycle): number {
    return round2(this.cycleInflow(cycle) - this.cyclePaid(cycle) - this.withdrawnFor(cycle.id));
  }

  /** Cutoffs that have arrived and are funded by this salary, most recent first. */
  arrivedCyclesFor(stream: IncomeStream): PaycheckCycle[] {
    const today = todayIso();
    return this.paycheckCycles()
      .filter((cycle) => cycle.cutoffDate <= today && this.streamFundsCycle(stream, cycle))
      .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate));
  }

  /**
   * Logs the salary actually received for a cutoff (null goes back to the expected amount).
   * When that salary was already deposited to a bank, the balance moves by the difference.
   */
  setCycleActualIncome(cycleId: string, amount: number | null): void {
    const cycle = this.paycheckCycles().find((item) => item.id === cycleId);
    if (!cycle) return;
    const actual = amount == null ? undefined : round2(Math.max(0, amount));
    const delta = actual == null ? 0 : round2(actual - cycle.baseIncome);
    let applied = cycle.actualDeltaApplied ?? 0;
    const accountId = this.depositAccountFor(cycle);
    const deposited = (cycle.depositedStreamIds ?? []).length > 0;
    if (deposited && accountId) {
      const move = round2(delta - applied);
      const note = `Actual pay · ${formatShortDate(cycle.cutoffDate)} cutoff`;
      if (move > 0) this.creditDestination(accountId, move, note);
      else if (move < 0) this.deductFromDestination(accountId, -move, note);
      applied = delta;
    }
    this.paycheckCycles.update((list) =>
      list.map((item) =>
        item.id === cycleId ? { ...item, actualIncome: actual, actualDeltaApplied: deposited && accountId ? applied : item.actualDeltaApplied } : item,
      ),
    );
  }

  cyclePlanned(cycle: PaycheckCycle): number {
    return round2(cycle.allocations.reduce((sum, item) => sum + item.plannedAmount, 0));
  }

  cyclePaid(cycle: PaycheckCycle): number {
    return round2(cycle.allocations.filter((item) => item.isPaid).reduce((sum, item) => sum + item.actualPaidAmount, 0));
  }

  cycleCash(cycle: PaycheckCycle): number {
    return round2(this.cycleInflow(cycle) - this.cyclePaid(cycle));
  }

  withdrawnFor(cycleId: string): number {
    return round2(this.withdrawals().filter((item) => item.cycleId === cycleId).reduce((sum, item) => sum + item.amount, 0));
  }

  remainingCash(cycle: PaycheckCycle): number {
    if (cycle.cutoffDate > todayIso()) return 0;
    return round2(this.cycleCash(cycle) - this.withdrawnFor(cycle.id));
  }

  addWithdrawal(draft: { cycleId: string; amount: number; note?: string }): void {
    const cycle = this.paycheckCycles().find((item) => item.id === draft.cycleId);
    if (!cycle || cycle.cutoffDate > todayIso()) return;
    const amount = round2(Math.min(Math.max(0, draft.amount), Math.max(0, this.remainingCash(cycle))));
    if (amount <= 0) return;
    const entry: CutoffWithdrawal = {
      id: crypto.randomUUID(),
      cycleId: cycle.id,
      sourceName: `${formatShortDate(cycle.cutoffDate)} cutoff`,
      amount,
      withdrawnOn: todayIso(),
      note: draft.note?.trim() || undefined,
      addedToCash: true,
    };
    // The salary sits in its bank or e-wallet, so taking cash out lowers that balance too.
    const accountId = this.depositAccountFor(cycle);
    if (accountId) {
      const taken = this.deductFromAccount(accountId, amount, `Cash withdrawal · ${formatShortDate(cycle.cutoffDate)} cutoff`);
      if (taken.deducted > 0) {
        entry.accountSavingsId = taken.savingsId;
        entry.accountDeducted = taken.deducted;
      }
    }
    this.cashOnHand.update((cash) => round2(cash + amount));
    this.logCash('CREDIT', amount, `Cash withdrawal · ${formatShortDate(cycle.cutoffDate)} cutoff`);
    this.withdrawals.update((list) => [...list, entry]);
  }

  /** Takes cash out of a savings account on any day and lowers that account's balance. */
  addSavingsWithdrawal(draft: { savingsId: string; amount: number; note?: string; withdrawnOn?: string }): boolean {
    const saving = this.bankSavings().find((item) => item.id === draft.savingsId);
    if (!saving) return false;
    const amount = round2(Math.min(Math.max(0, draft.amount), Math.max(0, saving.amount)));
    if (amount <= 0) return false;
    const date = draft.withdrawnOn && /^\d{4}-\d{2}-\d{2}$/.test(draft.withdrawnOn) ? draft.withdrawnOn : todayIso();
    const entry: CutoffWithdrawal = {
      id: crypto.randomUUID(),
      savingsId: saving.id,
      sourceName: `${saving.bankName} · ${saving.accountName}`,
      amount,
      withdrawnOn: date,
      note: draft.note?.trim() || undefined,
      addedToCash: true,
    };
    const next = { ...saving, amount: round2(Math.max(0, saving.amount - amount)) };
    this.bankSavings.update((list) => list.map((item) => (item.id === saving.id ? next : item)));
    this.logTransaction(next, 'DEBIT', amount, entry.note ? `Cash withdrawal · ${entry.note}` : 'Cash withdrawal', date);
    this.cashOnHand.update((cash) => round2(cash + amount));
    this.logCash('CREDIT', amount, entry.note ? `Cash withdrawal · ${entry.note}` : 'Cash withdrawal', date);
    this.withdrawals.update((list) => [...list, entry]);
    return true;
  }

  /** Removing a withdrawal puts the money back where it came from and takes it out of cash on hand. */
  removeWithdrawal(id: string): void {
    const entry = this.withdrawals().find((item) => item.id === id);
    if (!entry) return;
    if (entry.savingsId) this.refundToSavings(entry.savingsId, entry.amount, 'Withdrawal removed');
    if (entry.accountSavingsId) this.refundToSavings(entry.accountSavingsId, entry.accountDeducted ?? 0, 'Withdrawal removed');
    if (entry.addedToCash) {
      this.cashOnHand.update((cash) => round2(Math.max(0, cash - entry.amount)));
      this.logCash('DEBIT', entry.amount, 'Withdrawal removed');
    }
    this.withdrawals.update((list) => list.filter((item) => item.id !== id));
  }

  cycleUnallocated(cycle: PaycheckCycle): number {
    return round2(this.cycleInflow(cycle) - this.cyclePlanned(cycle) - cycle.sinkingFundReserved);
  }

  readonly salaryIncome = computed(() => this.incomeStreams().filter((stream) => isSalaryCutoff(stream.cutoffType)));

  readonly otherIncome = computed(() => this.incomeStreams().filter((stream) => !this.isSalaryStream(stream) && !this.isOwedInflow(stream)));

  cutoffIncomeLines(cycle: PaycheckCycle): CutoffIncomeLine[] {
    const day = Number(cycle.cutoffDate.slice(8, 10));
    const lines: CutoffIncomeLine[] = [];
    const cashAdvance = this.incomeStreams().find((stream) => stream.cutoffType === 'CASH_ADVANCE' && stream.specificDate === cycle.cutoffDate);
    const salaries = this.salaryIncome().filter((stream) => cycleMatchesSalaryDay(cycle.cutoffDate, stream.dayOfMonth));
    if (cashAdvance && cycle.baseIncome > 0) {
      lines.push({ id: cashAdvance.id, name: cashAdvance.name, amount: cycle.baseIncome, kind: 'other' });
    } else if (salaries.length && cycle.baseIncome > 0) {
      // The logged actual pay replaces the expected amount; with several salaries the difference sits on the first.
      const delta = cycle.actualIncome != null ? round2(cycle.actualIncome - cycle.baseIncome) : 0;
      salaries.forEach((item, index) => {
        const amount = index === 0 ? round2(Math.max(0, item.amount + delta)) : item.amount;
        lines.push({
          id: item.id,
          name: item.name,
          amount,
          kind: 'salary',
          expected: cycle.actualIncome != null && index === 0 ? item.amount : undefined,
          accountId: item.accountId,
        });
      });
    } else if (cycle.baseIncome > 0) {
      lines.push({ id: `${cycle.id}-base`, name: 'Income', amount: cycle.baseIncome, kind: 'other' });
    }

    const bonus = this.otherIncome().find((stream) => stream.specificDate === cycle.cutoffDate);
    const oweLines = this.receivables().flatMap((item) =>
      (item.payments ?? [])
        .filter((payment) => payment.cycleId === cycle.id || payment.cutoffDate === cycle.cutoffDate)
        .map((payment) => ({ id: payment.id, name: item.name, amount: payment.amount, kind: 'owe' as const })),
    );
    const oweTotal = round2(oweLines.reduce((sum, line) => sum + line.amount, 0));
    for (const line of oweLines) lines.push(line);
    const bonusAmount = bonus && cycle.supplementaryIncome > 0 ? bonus.amount : 0;
    if (bonus && bonusAmount > 0) {
      lines.push({ id: bonus.id, name: bonus.name, amount: bonusAmount, kind: 'other' });
    }
    const leftover = round2(cycle.supplementaryIncome - oweTotal - bonusAmount);
    if (leftover > 0.001) {
      const inflow = this.incomeStreams().find((stream) => stream.cutoffType === '30TH_INFLOW');
      const owed =
        this.receivables().find((item) => item.dueDayOfMonth != null && cycleMatchesSalaryDay(cycle.cutoffDate, item.dueDayOfMonth)) ??
        (day === 25 ? this.receivableForCutoff() : undefined);
      lines.push({
        id: inflow?.id ?? owed?.id ?? `${cycle.id}-extra`,
        name: owed?.name ?? inflow?.name ?? 'Other income',
        amount: leftover,
        kind: owed || inflow ? 'owe' : 'other',
      });
    }
    if (cycle.carryOverFromPrevious > 0) {
      lines.push({ id: `${cycle.id}-carry`, name: 'Carry-over', amount: cycle.carryOverFromPrevious, kind: 'carry' });
    }
    return lines;
  }

  private isSalaryStream(stream: IncomeStream): boolean {
    return isSalaryCutoff(stream.cutoffType);
  }

  private isOwedInflow(stream: IncomeStream): boolean {
    if (stream.cutoffType !== '30TH_INFLOW') return false;
    const name = stream.name.toLowerCase();
    return this.receivables().some((item) => name.includes(item.name.toLowerCase()) || item.dueDayOfMonth === stream.dayOfMonth);
  }

  private receivableForCutoff(): Receivable | undefined {
    return (
      this.receivables().find((item) => (item.dueDayOfMonth ?? 0) >= 25) ??
      this.receivables().find((item) => this.incomeStreams().some((stream) => stream.cutoffType === '30TH_INFLOW' && stream.name.toLowerCase().includes(item.name.toLowerCase())))
    );
  }

  setSinkingFund(cycleId: string, amount: number): void {
    const reserved = round2(Math.max(0, amount));
    this.paycheckCycles.update((cycles) => {
      const next = structuredClone(cycles);
      const index = next.findIndex((cycle) => cycle.id === cycleId);
      if (index < 0) return cycles;
      next[index].sinkingFundReserved = reserved;
      if (index + 1 < next.length) next[index + 1].carryOverFromPrevious = reserved;
      return next;
    });
  }

  toggleAllocationPaid(cycleId: string, allocationId: string): void {
    const cycles = structuredClone(this.paycheckCycles());
    const liabilities = structuredClone(this.liabilities());
    const allocation = cycles.find((cycle) => cycle.id === cycleId)?.allocations.find((item) => item.id === allocationId);
    if (!allocation) return;

    if (allocation.isPaid) {
      this.reversePayment(allocation, liabilities);
      this.restorePaymentSource(allocation);
      allocation.isPaid = false;
    } else {
      const amount = round2(allocation.actualPaidAmount > 0 ? allocation.actualPaidAmount : allocation.plannedAmount);
      allocation.actualPaidAmount = amount;
      allocation.isPaid = true;
      this.applyPayment(allocation, liabilities, amount);
    }

    this.paycheckCycles.set(cycles);
    this.liabilities.set(liabilities);
  }

  /**
   * Marks a bill paid and records where the money came from.
   * Pass one or more shares so a bill can come from the salary cutoff bank plus another source.
   */
  markAllocationPaid(
    cycleId: string,
    allocationId: string,
    payment: { method: PaymentMethod; accountId?: string; amount?: number; shares?: { method: PaymentMethod; accountId?: string; amount: number }[] },
  ): boolean {
    const cycles = structuredClone(this.paycheckCycles());
    const liabilities = structuredClone(this.liabilities());
    const allocation = cycles.find((cycle) => cycle.id === cycleId)?.allocations.find((item) => item.id === allocationId);
    if (!allocation || allocation.isPaid) return false;
    const drafts =
      payment.shares?.filter((share) => share.amount > 0) ??
      (payment.amount != null || payment.method
        ? [{ method: payment.method, accountId: payment.accountId, amount: payment.amount ?? 0 }]
        : []);
    if (!drafts.length) return false;
    const amount = round2(drafts.reduce((sum, share) => sum + Math.max(0, share.amount), 0));
    if (amount <= 0) return false;
    const seen = new Set<string>();
    for (const draft of drafts) {
      const key = draft.method === 'BANK' ? `bank:${draft.accountId}` : 'cash';
      if (seen.has(key)) return false;
      seen.add(key);
      const slice = round2(Math.max(0, draft.amount));
      if (slice <= 0) continue;
      if (draft.method === 'BANK') {
        if (!this.accounts().some((item) => item.id === draft.accountId)) return false;
        if (slice > this.accountBalance(draft.accountId ?? '') + 0.001) return false;
      } else if (slice > this.cashOnHand() + 0.001) {
        return false;
      }
    }

    const shares: AllocationPaymentShare[] = [];
    for (const draft of drafts) {
      const slice = round2(Math.max(0, draft.amount));
      if (slice <= 0) continue;
      if (draft.method === 'BANK') {
        const account = this.accounts().find((item) => item.id === draft.accountId);
        if (!account) return false;
        const taken = this.deductFromAccount(account.id, slice, `Paid ${allocation.name}`);
        shares.push({
          method: 'BANK',
          accountId: account.id,
          source: account.name,
          savingsId: taken.savingsId,
          amount: slice,
          deducted: taken.deducted,
        });
      } else {
        shares.push({
          method: 'CASH',
          source: 'Cash',
          amount: slice,
          deducted: this.deductFromCash(slice),
        });
      }
    }
    if (!shares.length) return false;

    const first = shares[0];
    allocation.actualPaidAmount = amount;
    allocation.isPaid = true;
    allocation.paymentMethod = first.method;
    allocation.paymentAccountId = first.accountId;
    allocation.paymentSource = shares.map((share) => share.source).filter(Boolean).join(' + ');
    allocation.paymentSavingsId = first.savingsId;
    allocation.paymentDeducted = round2(shares.reduce((sum, share) => sum + share.deducted, 0));
    allocation.paymentShares = shares;
    this.applyPayment(allocation, liabilities, amount);

    this.paycheckCycles.set(cycles);
    this.liabilities.set(liabilities);
    return true;
  }

  private restorePaymentSource(allocation: CutoffAllocationItem): void {
    const shares = allocation.paymentShares?.length
      ? allocation.paymentShares
      : allocation.paymentDeducted
        ? [{ method: allocation.paymentMethod, savingsId: allocation.paymentSavingsId, deducted: allocation.paymentDeducted }]
        : [];
    for (const share of shares) {
      if (!share.deducted) continue;
      if (share.method === 'BANK') this.refundToSavings(share.savingsId, share.deducted, `Unmarked ${allocation.name}`);
      else if (share.method === 'CASH') {
        this.cashOnHand.update((cash) => round2(cash + share.deducted));
        this.logCash('CREDIT', share.deducted, `Unmarked ${allocation.name}`);
      }
    }
    allocation.paymentMethod = undefined;
    allocation.paymentAccountId = undefined;
    allocation.paymentSource = undefined;
    allocation.paymentSavingsId = undefined;
    allocation.paymentDeducted = undefined;
    allocation.paymentShares = undefined;
  }

  /** Keeps the paid-from balance in step when the actual paid amount changes on a paid row. */
  private adjustPaymentSource(allocation: CutoffAllocationItem, delta: number): void {
    if (!allocation.paymentMethod || delta === 0) return;
    if (delta > 0) {
      const extra =
        allocation.paymentMethod === 'BANK' && allocation.paymentAccountId
          ? this.deductFromAccount(allocation.paymentAccountId, delta, `Paid more on ${allocation.name}`)
          : { deducted: this.deductFromCash(delta), savingsId: undefined };
      if (allocation.paymentMethod === 'BANK' && !allocation.paymentSavingsId) allocation.paymentSavingsId = extra.savingsId;
      allocation.paymentDeducted = round2((allocation.paymentDeducted ?? 0) + extra.deducted);
      return;
    }
    const refund = round2(Math.min(-delta, allocation.paymentDeducted ?? 0));
    if (refund <= 0) return;
    if (allocation.paymentMethod === 'BANK') this.refundToSavings(allocation.paymentSavingsId, refund, `Paid less on ${allocation.name}`);
    else {
      this.cashOnHand.update((cash) => round2(cash + refund));
      this.logCash('CREDIT', refund, `Paid less on ${allocation.name}`);
    }
    allocation.paymentDeducted = round2((allocation.paymentDeducted ?? 0) - refund);
  }

  updateAllocationAmount(cycleId: string, allocationId: string, field: 'plannedAmount' | 'actualPaidAmount', value: number): void {
    const amount = round2(Math.max(0, value));
    const cycles = structuredClone(this.paycheckCycles());
    const liabilities = structuredClone(this.liabilities());
    const allocation = cycles.find((cycle) => cycle.id === cycleId)?.allocations.find((item) => item.id === allocationId);
    if (!allocation) return;

    if (field === 'plannedAmount') {
      if (!allocation.isPaid) allocation.plannedAmount = amount;
    } else if (allocation.isPaid) {
      const delta = round2(amount - allocation.actualPaidAmount);
      allocation.actualPaidAmount = amount;
      allocation.appliedBalance = amount;
      this.adjustPaymentSource(allocation, delta);
      const liability = liabilities.find((item) => item.id === allocation.liabilityId);
      if (liability && liability.category !== 'LIVING_EXPENSE') {
        liability.totalBalance = round2(Math.max(0, liability.totalBalance - delta));
        this.syncPaidStatus(liability, allocation);
      }
    } else {
      allocation.actualPaidAmount = amount;
    }

    this.paycheckCycles.set(cycles);
    this.liabilities.set(liabilities);
  }

  addLiability(draft: LiabilityDraft): string | undefined {
    const assignedCutoff = draft.assignedCutoff ?? defaultCutoff(draft.dueDayOfMonth);
    const item: LiabilityItem = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      bankName: draft.bankName?.trim() || draft.name.trim(),
      category: draft.category,
      totalBalance: round2(Math.max(0, draft.totalBalance)),
      initialBalance: round2(Math.max(0, draft.totalBalance)),
      adjustments: [],
      monthlyAmortization: round2(Math.max(0, draft.monthlyAmortization)),
      minimumDue: draft.minimumDue && draft.minimumDue > 0 ? round2(draft.minimumDue) : undefined,
      dueDayOfMonth: Math.min(31, Math.max(1, Math.round(draft.dueDayOfMonth))),
      assignedCutoff,
      remainingTerms: draft.remainingTerms && draft.remainingTerms > 0 ? Math.round(draft.remainingTerms) : undefined,
      startDate: draft.startDate || todayIso(),
      endDate: draft.endDate || undefined,
      status: draft.status ?? (draft.category === 'PAST_DUE_OLA' ? 'PAST_DUE' : 'ACTIVE'),
      priorityRank: this.liabilities().reduce((max, current) => Math.max(max, current.priorityRank), 0) + 1,
      notes: draft.notes?.trim() || undefined,
      originalBalance: round2(Math.max(0, draft.totalBalance)),
      originalTerms: draft.remainingTerms,
      splitAcrossCutoffs: draft.splitAcrossCutoffs,
    };
    this.liabilities.update((list) => [...list, item]);
    const planned = item.monthlyAmortization > 0 ? item.monthlyAmortization : item.totalBalance;
    if (planned > 0) {
      return this.scheduleLiability(item, draft.addToFutureCutoffs !== false);
    }
    return undefined;
  }

  updateLiability(id: string, patch: Partial<LiabilityDraft>): void {
    this.liabilities.update((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        const dueDay = patch.dueDayOfMonth ?? item.dueDayOfMonth;
        const nextBalance = patch.totalBalance != null ? round2(Math.max(0, patch.totalBalance)) : item.totalBalance;
        let status = patch.status ?? item.status;
        if (item.category !== 'LIVING_EXPENSE' && nextBalance <= 0) status = 'PAID';
        if (status === 'PAID' && nextBalance > 0 && patch.status == null) status = item.category === 'PAST_DUE_OLA' ? 'PAST_DUE' : 'ACTIVE';
        return {
          ...item,
          name: patch.name?.trim() || item.name,
          bankName: patch.bankName?.trim() || item.bankName,
          category: patch.category ?? item.category,
          totalBalance: nextBalance,
          monthlyAmortization:
            patch.monthlyAmortization != null ? round2(Math.max(0, patch.monthlyAmortization)) : item.monthlyAmortization,
          minimumDue: patch.minimumDue != null ? (patch.minimumDue > 0 ? round2(patch.minimumDue) : undefined) : item.minimumDue,
          dueDayOfMonth: Math.min(31, Math.max(1, Math.round(dueDay))),
          assignedCutoff: patch.assignedCutoff ?? item.assignedCutoff,
          remainingTerms:
            patch.remainingTerms != null
              ? patch.remainingTerms > 0
                ? Math.round(patch.remainingTerms)
                : 0
              : item.remainingTerms,
          startDate: patch.startDate || item.startDate,
          endDate: patch.endDate !== undefined ? patch.endDate || undefined : item.endDate,
          status,
          notes: patch.notes !== undefined ? patch.notes.trim() || undefined : item.notes,
        };
      }),
    );
  }

  deleteLiability(id: string): void {
    this.liabilities.update((list) => list.filter((item) => item.id !== id));
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => ({
        ...cycle,
        allocations: cycle.allocations.filter((item) => item.liabilityId !== id || item.isPaid),
      })),
    );
  }

  logAdHocPayment(liabilityId: string, amount: number, note?: string): void {
    const payment = round2(Math.max(0, amount));
    if (payment <= 0) return;
    this.liabilities.update((list) =>
      list.map((item) => {
        if (item.id !== liabilityId) return item;
        const entry = `${todayIso()} logged ${formatPhp(payment)}${note ? ` — ${note}` : ''}`;
        if (item.category === 'LIVING_EXPENSE') {
          return { ...item, notes: [item.notes, entry].filter(Boolean).join(' | ') };
        }
        const totalBalance = round2(Math.max(0, item.totalBalance - payment));
        const cleared = totalBalance <= 0;
        return {
          ...item,
          totalBalance,
          status: cleared ? 'PAID' : item.status,
          remainingTerms: cleared ? 0 : item.remainingTerms,
          notes: [item.notes, entry].filter(Boolean).join(' | '),
        };
      }),
    );
  }

  /**
   * Logs one deposit for a single cutoff. The amount is not copied onto later cutoffs.
   * If a bank, e-wallet, or cash is linked, that balance is credited once the received date arrives.
   */
  addIncomeDeposit(draft: {
    name: string;
    amount: number;
    kind: IncomeReceipt['kind'];
    receivedOn: string;
    cycleId: string;
    accountId?: string;
  }): IncomeReceipt | undefined {
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.cycleId)) this.ensureCycle(draft.cycleId);
    const cycle =
      this.paycheckCycles().find((item) => item.id === draft.cycleId) ??
      this.paycheckCycles().find((item) => item.cutoffDate === draft.cycleId);
    const amount = round2(Math.max(0, draft.amount));
    const accountId = this.isValidDepositTarget(draft.accountId) ? draft.accountId : undefined;
    if (!cycle || amount <= 0 || !accountId) return undefined;
    const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(draft.receivedOn) ? draft.receivedOn : todayIso();
    const credited = receivedOn <= todayIso();
    const receipt: IncomeReceipt = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      kind: draft.kind,
      amount,
      receivedOn,
      cycleId: cycle.id,
      cutoffDate: cycle.cutoffDate,
      accountId,
      credited,
    };
    this.incomeReceipts.update((list) => [...list, receipt]);
    this.paycheckCycles.update((cycles) =>
      cycles.map((item) => {
        if (item.id !== cycle.id) return item;
        if (draft.kind === 'salary') return { ...item, actualIncome: round2((item.actualIncome ?? 0) + amount) };
        return { ...item, supplementaryIncome: round2(item.supplementaryIncome + amount) };
      }),
    );
    if (credited) this.creditDestination(accountId, amount, `${receipt.name} · ${formatShortDate(cycle.cutoffDate)} cutoff`);
    return receipt;
  }

  removeIncomeReceipt(id: string): void {
    const current = this.incomeReceipts().find((item) => item.id === id);
    if (!current) return;
    this.incomeReceipts.update((list) => list.filter((item) => item.id !== id));
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => {
        if (cycle.id !== current.cycleId && cycle.cutoffDate !== current.cutoffDate) return cycle;
        if (current.kind === 'salary') {
          const next = round2(Math.max(0, (cycle.actualIncome ?? 0) - current.amount));
          return { ...cycle, actualIncome: next > 0 ? next : undefined };
        }
        return { ...cycle, supplementaryIncome: round2(Math.max(0, cycle.supplementaryIncome - current.amount)) };
      }),
    );
    if (current.credited && current.accountId) {
      this.deductFromDestination(current.accountId, current.amount, `${current.name} removed`);
    }
  }

  addIncomeStream(draft: {
    name: string;
    amount: number;
    cutoffType: IncomeStream['cutoffType'];
    dayOfMonth: number;
    remainingMonths?: number;
    isOneTime?: boolean;
    specificDate?: string;
    accountId?: string;
  }): void {
    const accountId = this.isValidDepositTarget(draft.accountId) ? draft.accountId : undefined;
    const stream: IncomeStream = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      amount: round2(Math.max(0, draft.amount)),
      dayOfMonth: Math.min(31, Math.max(1, Math.round(draft.dayOfMonth))),
      cutoffType: draft.cutoffType,
      remainingMonths: draft.remainingMonths,
      isOneTime: draft.isOneTime,
      specificDate: draft.specificDate,
      accountId,
    };
    this.incomeStreams.update((list) => [...list, stream]);
    this.applyStreamToCycles(stream);
    if (accountId) {
      this.incomeStreams.update((list) =>
        list.map((item) => (item.id === stream.id ? { ...item, depositsFrom: this.depositStartDate(item) } : item)),
      );
    }
    this.lastSettledOn = '';
    this.settleArrivedDeposits();
  }

  updateIncome(
    id: string,
    patch: {
      name?: string;
      amount?: number;
      dayOfMonth?: number;
      cutoffType?: IncomeStream['cutoffType'];
      remainingMonths?: number;
      specificDate?: string;
      /** Pass an empty string to stop depositing this income to a bank or e-wallet. */
      accountId?: string;
    },
  ): void {
    const current = this.incomeStreams().find((stream) => stream.id === id);
    if (!current) return;
    let accountId = current.accountId;
    let depositsFrom = current.depositsFrom;
    let depositedOn = current.depositedOn;
    const amount = patch.amount != null ? round2(Math.max(0, patch.amount)) : current.amount;
    if (patch.accountId !== undefined) {
      const valid = this.isValidDepositTarget(patch.accountId) ? patch.accountId : undefined;
      if (valid !== current.accountId) {
        // A one-time income already credited moves out of the old account and lands in the new one.
        if (current.depositedOn && current.accountId) this.deductFromDestination(current.accountId, current.amount, `${current.name} moved out`);
        accountId = valid;
        depositsFrom = valid
          ? this.depositStartDate({
              ...current,
              cutoffType: patch.cutoffType ?? current.cutoffType,
              dayOfMonth: patch.dayOfMonth ?? current.dayOfMonth,
              specificDate: patch.specificDate !== undefined ? patch.specificDate || undefined : current.specificDate,
            })
          : undefined;
        depositedOn = undefined;
      }
    }
    if (depositedOn && accountId && amount !== current.amount) {
      const delta = round2(amount - current.amount);
      if (delta > 0) this.creditDestination(accountId, delta, `${current.name} amount changed`);
      else this.deductFromDestination(accountId, -delta, `${current.name} amount changed`);
    }
    const next: IncomeStream = {
      ...current,
      name: patch.name?.trim() || current.name,
      amount,
      dayOfMonth: patch.dayOfMonth != null ? Math.min(31, Math.max(1, Math.round(patch.dayOfMonth))) : current.dayOfMonth,
      cutoffType: patch.cutoffType ?? current.cutoffType,
      remainingMonths: patch.remainingMonths != null ? Math.max(0, Math.round(patch.remainingMonths)) : current.remainingMonths,
      specificDate: patch.specificDate !== undefined ? patch.specificDate || undefined : current.specificDate,
      accountId,
      depositsFrom,
      depositedOn,
    };
    this.incomeStreams.update((list) => list.map((stream) => (stream.id === id ? next : stream)));
    this.lastSettledOn = '';
    if (isSalaryCutoff(current.cutoffType) || isSalaryCutoff(next.cutoffType)) {
      if (isSalaryCutoff(next.cutoffType)) this.ensureSalaryCycles(next.dayOfMonth);
      const days = new Set([current.dayOfMonth, next.dayOfMonth]);
      const anchor = todayIso();
      this.paycheckCycles.update((cycles) =>
        cycles.map((cycle) => {
          if (cycle.cutoffDate < anchor) return cycle;
          for (const day of days) {
            if (cycleMatchesSalaryDay(cycle.cutoffDate, day)) return { ...cycle, baseIncome: this.salaryTotalForDay(day) };
          }
          return cycle;
        }),
      );
      this.settleArrivedDeposits();
      return;
    }
    const anchor = todayIso();
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => {
        if (cycle.cutoffDate < anchor) return cycle;
        const day = Number(cycle.cutoffDate.slice(8, 10));
        if (next.cutoffType === '30TH_INFLOW' && day === 25) return { ...cycle, supplementaryIncome: next.amount };
        if ((next.cutoffType === 'BONUS' || next.isOneTime) && next.specificDate === cycle.cutoffDate) {
          return { ...cycle, supplementaryIncome: next.amount };
        }
        if (current.specificDate && current.specificDate !== next.specificDate && current.specificDate === cycle.cutoffDate) {
          return { ...cycle, supplementaryIncome: round2(Math.max(0, cycle.supplementaryIncome - current.amount)) };
        }
        return cycle;
      }),
    );
    this.settleArrivedDeposits();
  }

  removeIncome(id: string): void {
    const current = this.incomeStreams().find((stream) => stream.id === id);
    if (!current) return;
    this.incomeStreams.update((list) => list.filter((stream) => stream.id !== id));
    if (current.depositedOn && current.accountId) this.deductFromDestination(current.accountId, current.amount);
    const anchor = todayIso();
    if (isSalaryCutoff(current.cutoffType)) {
      this.paycheckCycles.update((cycles) =>
        cycles.map((cycle) => {
          if (cycle.cutoffDate < anchor || !cycleMatchesSalaryDay(cycle.cutoffDate, current.dayOfMonth)) return cycle;
          return { ...cycle, baseIncome: this.salaryTotalForDay(current.dayOfMonth) };
        }),
      );
      return;
    }
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => {
        if (cycle.cutoffDate < anchor) return cycle;
        const day = Number(cycle.cutoffDate.slice(8, 10));
        if (current.cutoffType === '30TH_INFLOW' && day === 25) {
          const remaining = this.incomeStreams().find((stream) => stream.cutoffType === '30TH_INFLOW');
          return { ...cycle, supplementaryIncome: remaining?.amount ?? 0 };
        }
        if (current.specificDate !== cycle.cutoffDate) return cycle;
        if (current.cutoffType === 'CASH_ADVANCE') {
          return { ...cycle, baseIncome: round2(Math.max(0, cycle.baseIncome - current.amount)) };
        }
        return { ...cycle, supplementaryIncome: round2(Math.max(0, cycle.supplementaryIncome - current.amount)) };
      }),
    );
  }

  private salaryTotalForDay(day: number): number {
    return round2(
      this.salaryIncome()
        .filter((stream) => stream.dayOfMonth === day)
        .reduce((sum, stream) => sum + stream.amount, 0),
    );
  }

  private applyStreamToCycles(stream: IncomeStream): void {
    if (this.isSalaryStream(stream)) this.ensureSalaryCycles(stream.dayOfMonth);
    const anchor = todayIso();
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => {
        if (cycle.cutoffDate < anchor) return cycle;
        const day = Number(cycle.cutoffDate.slice(8, 10));
        if (this.isSalaryStream(stream) && cycleMatchesSalaryDay(cycle.cutoffDate, stream.dayOfMonth)) {
          return { ...cycle, baseIncome: this.salaryTotalForDay(stream.dayOfMonth) };
        }
        if (stream.isOneTime && stream.specificDate === cycle.cutoffDate) return { ...cycle, supplementaryIncome: stream.amount };
        if (stream.cutoffType === '30TH_INFLOW' && day === 25) return { ...cycle, supplementaryIncome: stream.amount };
        return cycle;
      }),
    );
  }

  private ensureSalaryCycles(day: number): void {
    const existing = new Set(this.paycheckCycles().map((cycle) => cycle.cutoffDate));
    const created = salaryCutoffDates(day, this.paycheckCycles(), todayIso())
      .filter((iso) => !existing.has(iso))
      .map((iso) => ({
        id: iso,
        label: `${formatLongDate(iso)} Cutoff`,
        cutoffDate: iso,
        baseIncome: 0,
        supplementaryIncome: 0,
        carryOverFromPrevious: 0,
        sinkingFundReserved: 0,
        allocations: [],
      }));
    if (created.length === 0) return;
    this.paycheckCycles.update((cycles) => [...cycles, ...created].sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate)));
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.notificationsEnabled.set(enabled);
  }

  toggleDebtHidden(): void {
    this.hideDebtTotal.update((hidden) => !hidden);
  }

  toggleSavingsHidden(): void {
    this.hideSavingsTotal.update((hidden) => !hidden);
  }

  exportSnapshot(): BudgetSnapshot {
    return {
      version: 1,
      incomeStreams: this.incomeStreams(),
      liabilities: this.liabilities(),
      paycheckCycles: this.paycheckCycles(),
      notificationsEnabled: this.notificationsEnabled(),
      bankSavings: this.bankSavings(),
      receivables: this.receivables(),
      withdrawals: this.withdrawals(),
      sharedExpenses: this.sharedExpenses(),
      accounts: this.accounts(),
      cashOnHand: this.cashOnHand(),
      cashEnabled: this.cashEnabled(),
      transactions: this.transactions(),
      incomeReceipts: this.incomeReceipts(),
      hideDebtTotal: this.hideDebtTotal(),
      hideSavingsTotal: this.hideSavingsTotal(),
      revision: this.revision,
    };
  }

  importSnapshot(value: unknown): boolean {
    const snapshot = snapshotFromImport(value);
    if (!snapshot) return false;
    this.applySnapshot(snapshot);
    this.flushSave();
    return true;
  }

  resetToSeed(): void {
    this.applySnapshot({
      version: 1,
      incomeStreams: [],
      liabilities: [],
      paycheckCycles: [],
      notificationsEnabled: false,
      bankSavings: [],
      receivables: [],
      accounts: [],
      cashOnHand: 0,
      cashEnabled: false,
      transactions: [],
      incomeReceipts: [],
    });
    this.flushSave();
  }

  addAccount(draft: { name: string; kind: MoneyAccount['kind']; notes?: string }): MoneyAccount | null {
    const name = draft.name.trim();
    if (!name) return null;
    const account: MoneyAccount = { id: crypto.randomUUID(), name, kind: draft.kind, notes: draft.notes?.trim() || undefined };
    this.accounts.update((list) => [...list, account]);
    // Savings rows typed with the same bank name before it was registered now belong to it.
    const linked = this.bankSavings()
      .filter((item) => !item.accountId && item.bankName.trim().toLowerCase() === name.toLowerCase())
      .map((item) => item.id);
    if (linked.length) {
      this.bankSavings.update((list) => list.map((item) => (linked.includes(item.id) ? { ...item, accountId: account.id } : item)));
      this.transactions.update((list) => list.map((item) => (linked.includes(item.savingsId) ? { ...item, accountId: account.id } : item)));
    }
    return account;
  }

  updateAccount(id: string, patch: Partial<Pick<MoneyAccount, 'name' | 'kind' | 'notes'>>): void {
    const current = this.accounts().find((item) => item.id === id);
    if (!current) return;
    const name = patch.name?.trim() || current.name;
    this.accounts.update((list) =>
      list.map((item) => (item.id === id ? { ...item, name, kind: patch.kind ?? item.kind, notes: patch.notes != null ? patch.notes.trim() || undefined : item.notes } : item)),
    );
    if (name !== current.name) {
      this.bankSavings.update((list) => list.map((item) => (item.accountId === id ? { ...item, bankName: name } : item)));
    }
  }

  /** Removing a bank or e-wallet keeps its savings rows and income; they just stop pointing at it. */
  removeAccount(id: string): void {
    this.accounts.update((list) => list.filter((item) => item.id !== id));
    this.bankSavings.update((list) => list.map((item) => (item.accountId === id ? { ...item, accountId: undefined } : item)));
    this.incomeStreams.update((list) =>
      list.map((item) => (item.accountId === id ? { ...item, accountId: undefined, depositsFrom: undefined } : item)),
    );
  }

  accountName(id: string | undefined): string {
    if (id === CASH_DEPOSIT_ID) return 'Cash on hand';
    return this.accounts().find((item) => item.id === id)?.name ?? '';
  }

  /** "BPI · Payroll account", "Cash on hand", or '' when nothing is linked. */
  accountLabel(id: string | undefined): string {
    if (id === CASH_DEPOSIT_ID) return 'Cash on hand';
    const account = this.accounts().find((item) => item.id === id);
    return account ? `${account.name} · ${ACCOUNT_KIND_LABEL[account.kind]}` : '';
  }

  isValidDepositTarget(id: string | undefined): id is string {
    return id === CASH_DEPOSIT_ID || Boolean(id && this.accounts().some((item) => item.id === id));
  }

  /** Marks cash on hand as an income destination and optionally adds an opening amount. */
  enableCashOnHand(opening = 0): void {
    this.cashEnabled.set(true);
    const extra = round2(Math.max(0, opening));
    if (extra > 0) this.addCashOnHand(extra, 'Cash on hand opening');
  }

  /** Adds cash and writes a credit to history. */
  addCashOnHand(amount: number, description = 'Cash added'): void {
    const extra = round2(Math.max(0, amount));
    if (extra <= 0) return;
    this.cashEnabled.set(true);
    this.cashOnHand.update((cash) => round2(cash + extra));
    this.logCash('CREDIT', extra, description);
  }

  /** Savings rows that belong to a registered bank or e-wallet. */
  savingsForAccount(accountId: string): BankSaving[] {
    return this.bankSavings().filter((item) => item.accountId === accountId);
  }

  accountBalance(accountId: string): number {
    return round2(this.savingsForAccount(accountId).reduce((sum, item) => sum + Math.max(0, item.amount), 0));
  }

  setCashOnHand(amount: number): void {
    this.cashOnHand.set(round2(Math.max(0, amount)));
  }

  /**
   * First cutoff that should land in the linked bank: the latest pay that has already arrived,
   * or the one-time date if that day is already here. Earlier history is left alone.
   */
  private depositStartDate(stream: Pick<IncomeStream, 'cutoffType' | 'dayOfMonth' | 'isOneTime' | 'specificDate'>): string {
    const today = todayIso();
    if (this.isOneTimeIncome(stream as IncomeStream) && stream.specificDate && stream.specificDate <= today) {
      return stream.specificDate;
    }
    if (isSalaryCutoff(stream.cutoffType)) {
      const latest = this.paycheckCycles()
        .filter((cycle) => cycle.cutoffDate <= today && cycleMatchesSalaryDay(cycle.cutoffDate, stream.dayOfMonth))
        .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate))[0];
      if (latest) return latest.cutoffDate;
    }
    return today;
  }

  /**
   * Deposits income into its bank or e-wallet once the cutoff date has arrived.
   * Each cutoff is credited once per income stream. When a bank is first linked, the latest
   * arrived cutoff is included so the pay that is already in lands on Savings.
   */
  settleArrivedDeposits(): void {
    this.settleIncomeReceipts();
    const today = todayIso();
    const streams = this.incomeStreams().filter((stream) => this.isValidDepositTarget(stream.accountId));
    if (!streams.length) return;
    let savings = this.bankSavings();
    let cash = this.cashOnHand();
    let changed = false;
    const logs: AccountTransaction[] = [];
    const credit = (accountId: string, amount: number, description: string, date: string) => {
      if (amount === 0) return;
      if (accountId === CASH_DEPOSIT_ID) {
        cash = round2(Math.max(0, cash + amount));
        changed = true;
        return;
      }
      const target = this.savingRowForAccount(savings, accountId);
      const next = { ...target.row, amount: round2(Math.max(0, target.row.amount + amount)) };
      savings = target.list.map((item) => (item.id === target.row.id ? next : item));
      logs.push({
        id: crypto.randomUUID(),
        savingsId: next.id,
        accountId: next.accountId,
        date,
        type: amount > 0 ? 'CREDIT' : 'DEBIT',
        amount: round2(Math.abs(amount)),
        balanceAfter: round2(next.amount),
        description,
      });
      changed = true;
    };

    // Salary lands once per cutoff that has arrived.
    const salaries = streams.filter((stream) => isSalaryCutoff(stream.cutoffType));
    const startByStream = new Map(
      salaries.map((stream) => {
        const start = this.depositStartDate(stream);
        const from = stream.depositsFrom && stream.depositsFrom <= start ? stream.depositsFrom : start;
        return [stream.id, from] as const;
      }),
    );
    const cycles = this.paycheckCycles().map((cycle) => {
      if (cycle.cutoffDate > today) return cycle;
      const done = new Set(cycle.depositedStreamIds ?? []);
      const firstDeposit = done.size === 0;
      let touched = false;
      let deltaAccount: string | undefined;
      for (const stream of salaries) {
        if (done.has(stream.id) || !cycleMatchesSalaryDay(cycle.cutoffDate, stream.dayOfMonth)) continue;
        const from = startByStream.get(stream.id);
        if (from && cycle.cutoffDate < from) continue;
        credit(stream.accountId!, stream.amount, `${stream.name} · ${formatShortDate(cycle.cutoffDate)} cutoff`, cycle.cutoffDate);
        deltaAccount ??= stream.accountId!;
        done.add(stream.id);
        touched = true;
      }
      if (!touched) return cycle;
      // The actual pay was logged before the deposit landed: the bank gets the real amount, not the expected one.
      let actualDeltaApplied = cycle.actualDeltaApplied;
      if (firstDeposit && deltaAccount && cycle.actualIncome != null) {
        const delta = round2(cycle.actualIncome - cycle.baseIncome);
        if (delta !== 0) credit(deltaAccount, delta, `Actual pay · ${formatShortDate(cycle.cutoffDate)} cutoff`, cycle.cutoffDate);
        actualDeltaApplied = delta;
      }
      return { ...cycle, depositedStreamIds: [...done], actualDeltaApplied };
    });

    // One-time income lands on the day it is received, whether or not a cutoff falls on that day.
    let streamsChanged = false;
    const nextStreams = this.incomeStreams().map((stream) => {
      if (!stream.accountId || stream.depositedOn || !this.isOneTimeIncome(stream) || !stream.specificDate) return stream;
      if (stream.specificDate > today) return stream;
      const start = this.depositStartDate(stream);
      const from = stream.depositsFrom && stream.depositsFrom <= start ? stream.depositsFrom : start;
      if (from && stream.specificDate < from) return stream;
      credit(stream.accountId, stream.amount, stream.name, stream.specificDate);
      streamsChanged = true;
      return { ...stream, depositedOn: today };
    });

    if (!changed) return;
    this.bankSavings.set(savings);
    this.cashOnHand.set(cash);
    this.paycheckCycles.set(cycles);
    if (streamsChanged) this.incomeStreams.set(nextStreams);
    if (logs.length) this.transactions.update((list) => [...list, ...logs]);
  }

  /** Credits dated income deposits once their received date has arrived. */
  private settleIncomeReceipts(): void {
    const today = todayIso();
    let changed = false;
    const next = this.incomeReceipts().map((item) => {
      if (item.credited || item.receivedOn > today || !this.isValidDepositTarget(item.accountId)) return item;
      this.creditDestination(item.accountId, item.amount, `${item.name} · ${formatShortDate(item.cutoffDate)} cutoff`);
      changed = true;
      return { ...item, credited: true };
    });
    if (changed) this.incomeReceipts.set(next);
  }

  private isOneTimeIncome(stream: IncomeStream): boolean {
    return Boolean(stream.isOneTime) || stream.cutoffType === 'BONUS';
  }

  private streamFundsCycle(stream: IncomeStream, cycle: PaycheckCycle): boolean {
    if (isSalaryCutoff(stream.cutoffType)) return cycleMatchesSalaryDay(cycle.cutoffDate, stream.dayOfMonth);
    if (this.isOneTimeIncome(stream)) return stream.specificDate === cycle.cutoffDate;
    return false;
  }

  /** Finds the savings row that holds an account's balance, creating one when the account has none yet. */
  private savingRowForAccount(list: BankSaving[], accountId: string): { list: BankSaving[]; row: BankSaving } {
    const rows = list.filter((item) => item.accountId === accountId);
    if (rows.length) {
      const row = rows.reduce((best, item) => (item.amount > best.amount ? item : best), rows[0]);
      return { list, row };
    }
    const account = this.accounts().find((item) => item.id === accountId);
    const row: BankSaving = {
      id: crypto.randomUUID(),
      bankName: account?.name ?? 'Bank',
      accountName: 'Balance',
      amount: 0,
      accountId,
    };
    return { list: [...list, row], row };
  }

  /** Bank or e-wallet the salary for this cutoff is deposited to, when one is set. */
  payAccountFor(cycle: PaycheckCycle): string | undefined {
    return this.incomeStreams().find((stream) => stream.accountId && this.streamFundsCycle(stream, cycle))?.accountId;
  }

  private depositAccountFor(cycle: PaycheckCycle): string | undefined {
    return this.payAccountFor(cycle);
  }

  /** Appends a debit or credit to a savings row's history. */
  private logTransaction(row: BankSaving, type: AccountTransaction['type'], amount: number, description: string, date = todayIso()): void {
    if (amount <= 0) return;
    const entry: AccountTransaction = {
      id: crypto.randomUUID(),
      savingsId: row.id,
      accountId: row.accountId,
      date,
      type,
      amount: round2(amount),
      balanceAfter: round2(row.amount),
      description,
    };
    this.transactions.update((list) => [...list, entry]);
  }

  private logCash(type: AccountTransaction['type'], amount: number, description: string, date = todayIso()): void {
    if (amount <= 0) return;
    const entry: AccountTransaction = {
      id: crypto.randomUUID(),
      savingsId: CASH_DEPOSIT_ID,
      accountId: CASH_DEPOSIT_ID,
      date,
      type,
      amount: round2(amount),
      balanceAfter: this.cashOnHand(),
      description,
    };
    this.transactions.update((list) => [...list, entry]);
  }

  /** History for one savings row, newest first. */
  transactionsFor(savingsId: string): AccountTransaction[] {
    return this.transactions()
      .filter((item) => item.savingsId === savingsId)
      .sort((a, b) => b.date.localeCompare(a.date) || this.transactions().indexOf(b) - this.transactions().indexOf(a));
  }

  /** History across every savings row of a registered bank or e-wallet, newest first. */
  transactionsForAccount(accountId: string): AccountTransaction[] {
    const all = this.transactions();
    return all
      .filter((item) => item.accountId === accountId)
      .sort((a, b) => b.date.localeCompare(a.date) || all.indexOf(b) - all.indexOf(a));
  }

  /** Takes money out of an account's balance. Returns what was actually taken and from which savings row. */
  private deductFromAccount(accountId: string, amount: number, description = 'Debit'): { deducted: number; savingsId?: string } {
    const found = this.savingRowForAccount(this.bankSavings(), accountId);
    const deducted = round2(Math.min(Math.max(0, amount), Math.max(0, found.row.amount)));
    if (deducted <= 0) return { deducted: 0 };
    const next = { ...found.row, amount: round2(found.row.amount - deducted) };
    this.bankSavings.set(found.list.map((item) => (item.id === found.row.id ? next : item)));
    this.logTransaction(next, 'DEBIT', deducted, description);
    return { deducted, savingsId: found.row.id };
  }

  private creditAccount(accountId: string, amount: number, description = 'Credit'): void {
    if (amount <= 0) return;
    const found = this.savingRowForAccount(this.bankSavings(), accountId);
    const next = { ...found.row, amount: round2(found.row.amount + amount) };
    this.bankSavings.set(found.list.map((item) => (item.id === found.row.id ? next : item)));
    this.logTransaction(next, 'CREDIT', amount, description);
  }

  private creditDestination(accountId: string, amount: number, description = 'Credit'): void {
    if (amount <= 0) return;
    if (accountId === CASH_DEPOSIT_ID) {
      this.cashOnHand.update((cash) => round2(cash + amount));
      this.logCash('CREDIT', amount, description);
      return;
    }
    this.creditAccount(accountId, amount, description);
  }

  private deductFromDestination(accountId: string, amount: number, description = 'Debit'): number {
    if (accountId === CASH_DEPOSIT_ID) return this.deductFromCash(amount);
    return this.deductFromAccount(accountId, amount, description).deducted;
  }

  private refundToSavings(savingsId: string | undefined, amount: number, description = 'Refund'): void {
    if (!savingsId || amount <= 0) return;
    const row = this.bankSavings().find((item) => item.id === savingsId);
    if (!row) return;
    const next = { ...row, amount: round2(row.amount + amount) };
    this.bankSavings.update((list) => list.map((item) => (item.id === savingsId ? next : item)));
    this.logTransaction(next, 'CREDIT', amount, description);
  }

  private deductFromCash(amount: number): number {
    const deducted = round2(Math.min(Math.max(0, amount), this.cashOnHand()));
    if (deducted > 0) {
      this.cashOnHand.update((cash) => round2(cash - deducted));
      this.logCash('DEBIT', deducted, 'Cash spent');
    }
    return deducted;
  }

  /**
   * Adds a balance to a registered bank or e-wallet. The amount is added to that account's
   * existing row instead of creating a second one.
   */
  addBankSaving(draft: { bankName?: string; accountName?: string; amount: number; notes?: string; accountId?: string }): BankSaving | undefined {
    const account = draft.accountId ? this.accounts().find((item) => item.id === draft.accountId) : undefined;
    const amount = round2(Math.max(0, draft.amount));
    if (amount <= 0) return undefined;
    if (account) {
      const found = this.savingRowForAccount(this.bankSavings(), account.id);
      const opening = found.row.amount === 0 && !this.bankSavings().some((item) => item.id === found.row.id);
      const next = { ...found.row, amount: round2(found.row.amount + amount), bankName: account.name, accountId: account.id };
      this.bankSavings.set(found.list.map((item) => (item.id === found.row.id ? next : item)));
      this.logTransaction(next, 'CREDIT', amount, opening ? 'Opening balance' : 'Balance added');
      return next;
    }
    const bankName = draft.bankName?.trim() ?? '';
    if (!bankName) return undefined;
    const accountName = draft.accountName?.trim() || 'Savings';
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const existing = this.bankSavings().find((item) => same(item.bankName, bankName) && same(item.accountName, accountName));
    if (existing) {
      const next = { ...existing, amount: round2(existing.amount + amount), notes: draft.notes?.trim() || existing.notes };
      this.bankSavings.update((list) => list.map((item) => (item.id === existing.id ? next : item)));
      this.logTransaction(next, 'CREDIT', amount, 'Balance added');
      return next;
    }
    const saving: BankSaving = {
      id: crypto.randomUUID(),
      bankName,
      accountName,
      amount,
      notes: draft.notes?.trim() || undefined,
    };
    this.bankSavings.update((list) => [...list, saving]);
    this.logTransaction(saving, 'CREDIT', amount, 'Opening balance');
    return saving;
  }

  updateBankSaving(id: string, patch: Partial<Pick<BankSaving, 'bankName' | 'accountName' | 'amount' | 'notes' | 'accountId'>>): void {
    const current = this.bankSavings().find((item) => item.id === id);
    if (!current) return;
    const account = patch.accountId ? this.accounts().find((item) => item.id === patch.accountId) : undefined;
    const next: BankSaving = {
      ...current,
      bankName: account?.name ?? (patch.bankName?.trim() || current.bankName),
      accountId: patch.accountId !== undefined ? account?.id : current.accountId,
      accountName: patch.accountName?.trim() || current.accountName,
      amount: patch.amount != null ? round2(Math.max(0, patch.amount)) : current.amount,
      notes: patch.notes != null ? patch.notes.trim() || undefined : current.notes,
    };
    this.bankSavings.update((list) => list.map((item) => (item.id === id ? next : item)));
    const delta = round2(next.amount - current.amount);
    if (delta > 0) this.logTransaction(next, 'CREDIT', delta, 'Balance adjusted');
    else if (delta < 0) this.logTransaction(next, 'DEBIT', -delta, 'Balance adjusted');
    if (next.accountId !== current.accountId || next.bankName !== current.bankName) {
      // Keep history attached to the bank the row now belongs to.
      this.transactions.update((list) => list.map((item) => (item.savingsId === id ? { ...item, accountId: next.accountId } : item)));
    }
  }

  removeBankSaving(id: string): void {
    this.bankSavings.update((list) => list.filter((item) => item.id !== id));
    this.transactions.update((list) => list.filter((item) => item.savingsId !== id));
  }

  addReceivable(draft: {
    name: string;
    totalDebt: number;
    paymentAmount: number;
    terms: number;
    notes?: string;
    dueDayOfMonth?: number;
    borrowedOn?: string;
  }): void {
    const item: Receivable = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      totalDebt: round2(Math.max(0, draft.totalDebt)),
      amountReceived: 0,
      paymentAmount: round2(Math.max(0, draft.paymentAmount)),
      terms: Math.max(1, Math.round(draft.terms || 1)),
      dueDayOfMonth: normalizeDueDay(draft.dueDayOfMonth),
      borrowedOn: draft.borrowedOn || undefined,
      notes: draft.notes?.trim() || undefined,
    };
    this.receivables.update((list) => [...list, item]);
  }

  updateReceivable(
    id: string,
    patch: Partial<Pick<Receivable, 'name' | 'totalDebt' | 'paymentAmount' | 'terms' | 'notes' | 'dueDayOfMonth' | 'borrowedOn'>>,
  ): void {
    this.receivables.update((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        const totalDebt = patch.totalDebt != null ? round2(Math.max(0, patch.totalDebt)) : item.totalDebt;
        return {
          ...item,
          name: patch.name?.trim() || item.name,
          totalDebt,
          amountReceived: round2(Math.min(item.amountReceived, totalDebt)),
          paymentAmount: patch.paymentAmount != null ? round2(Math.max(0, patch.paymentAmount)) : item.paymentAmount,
          terms: patch.terms != null ? Math.max(1, Math.round(patch.terms)) : item.terms,
          dueDayOfMonth: patch.dueDayOfMonth != null ? normalizeDueDay(patch.dueDayOfMonth) : item.dueDayOfMonth,
          borrowedOn: patch.borrowedOn != null ? patch.borrowedOn || undefined : item.borrowedOn,
          notes: patch.notes != null ? patch.notes.trim() || undefined : item.notes,
        };
      }),
    );
    const saved = this.receivables().find((item) => item.id === id);
    if (!saved || patch.paymentAmount == null) return;
    const inflow = this.incomeStreams().find(
      (stream) => stream.cutoffType === '30TH_INFLOW' && stream.name.toLowerCase().includes(saved.name.toLowerCase()),
    );
    if (inflow) this.updateIncome(inflow.id, { amount: saved.paymentAmount });
  }

  recordReceivablePayment(id: string, amount: number, paidOn = todayIso()): string {
    const payment = round2(Math.max(0, amount));
    const current = this.receivables().find((item) => item.id === id);
    if (!current || payment <= 0) return '';
    const remaining = round2(Math.max(0, current.totalDebt - current.amountReceived));
    const applied = round2(Math.min(payment, remaining));
    if (applied <= 0) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? paidOn : todayIso();
    // A shared-bill share is already excluded from your cutoff, so collecting it is not extra cutoff income.
    if (current.sharedExpenseId && current.shareId) {
      const entry: ReceivablePayment = { id: crypto.randomUUID(), date, amount: applied };
      this.receivables.update((list) =>
        list.map((item) => {
          if (item.id !== id) return item;
          return { ...item, amountReceived: round2(item.amountReceived + applied), payments: [...(item.payments ?? []), entry] };
        }),
      );
      const updated = this.receivables().find((item) => item.id === id);
      if (updated && updated.amountReceived + 0.001 >= updated.totalDebt) {
        this.patchShare(current.sharedExpenseId, current.shareId, { paid: true, paidOn: date });
      }
      return `${current.name}'s payment of ${formatPhp(applied)} was recorded.`;
    }
    const cycle = this.cutoffForOwedPayment(date);
    const entry: ReceivablePayment = {
      id: crypto.randomUUID(),
      date,
      amount: applied,
      cycleId: cycle.id,
      cutoffDate: cycle.cutoffDate,
    };
    this.receivables.update((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        return { ...item, amountReceived: round2(item.amountReceived + applied), payments: [...(item.payments ?? []), entry] };
      }),
    );
    this.paycheckCycles.update((cycles) =>
      cycles.map((item) =>
        item.id === cycle.id ? { ...item, supplementaryIncome: round2(item.supplementaryIncome + applied) } : item,
      ),
    );
    return `${current.name}'s payment of ${formatPhp(applied)} on ${formatLongDate(date)} was added to the ${formatShortDate(cycle.cutoffDate)} cutoff.`;
  }

  removeReceivablePayment(receivableId: string, paymentId: string): void {
    const current = this.receivables().find((item) => item.id === receivableId);
    const payment = current?.payments?.find((item) => item.id === paymentId);
    if (!current || !payment) return;
    this.receivables.update((list) =>
      list.map((item) => {
        if (item.id !== receivableId) return item;
        return {
          ...item,
          amountReceived: round2(Math.max(0, item.amountReceived - payment.amount)),
          payments: (item.payments ?? []).filter((row) => row.id !== paymentId),
        };
      }),
    );
    if (payment.cycleId || payment.cutoffDate) {
      this.paycheckCycles.update((cycles) =>
        cycles.map((cycle) =>
          cycle.id === payment.cycleId || cycle.cutoffDate === payment.cutoffDate
            ? { ...cycle, supplementaryIncome: round2(Math.max(0, cycle.supplementaryIncome - payment.amount)) }
            : cycle,
        ),
      );
    }
  }

  /**
   * An owed payment adds to the salary cutoff that is already open on the paid date
   * (the latest salary cutoff on or before that day). It does not wait for the person's
   * due day, and it is not counted until you log it as paid.
   */
  private cutoffForOwedPayment(paidOn: string): PaycheckCycle {
    const salaryDays = new Set(this.salaryIncome().map((stream) => stream.dayOfMonth));
    const isSalaryCycle = (cycle: PaycheckCycle) =>
      salaryDays.size ? [...salaryDays].some((day) => cycleMatchesSalaryDay(cycle.cutoffDate, day)) : cycle.baseIncome > 0;
    const open = this.paycheckCycles()
      .filter((cycle) => cycle.cutoffDate <= paidOn && isSalaryCycle(cycle))
      .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate))[0];
    if (open) return open;
    const upcoming = this.paycheckCycles()
      .filter((cycle) => cycle.cutoffDate >= paidOn && isSalaryCycle(cycle))
      .sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate))[0];
    if (upcoming) return upcoming;
    const anyOpen = this.paycheckCycles()
      .filter((cycle) => cycle.cutoffDate <= paidOn)
      .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate))[0];
    if (anyOpen) return anyOpen;
    const created: PaycheckCycle = {
      id: paidOn,
      label: `${formatLongDate(paidOn)} Cutoff`,
      cutoffDate: paidOn,
      baseIncome: 0,
      supplementaryIncome: 0,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [],
    };
    this.paycheckCycles.update((cycles) => [...cycles, created].sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate)));
    return this.paycheckCycles().find((cycle) => cycle.id === created.id) ?? created;
  }

  removeReceivable(id: string): void {
    const current = this.receivables().find((item) => item.id === id);
    if (current?.sharedExpenseId && current.shareId) this.detachShare(current.sharedExpenseId, current.shareId);
    this.receivables.update((list) => list.filter((item) => item.id !== id));
  }

  addSharedExpense(name: string, totalAmount: number, expenseDate: string): boolean {
    const title = name.trim();
    const total = round2(Math.max(0, totalAmount));
    const date = expenseDate.trim();
    if (!title || total <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const item: SharedExpense = { id: crypto.randomUUID(), name: title, totalAmount: total, expenseDate: date, shares: [] };
    this.sharedExpenses.update((list) => [...list, item]);
    this.upsertSharedBill(item);
    return true;
  }

  setSharedExpenseDate(id: string, expenseDate: string): void {
    const date = expenseDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const expense = this.sharedExpenses().find((item) => item.id === id);
    if (!expense) return;
    const dueDay = Number(date.slice(8, 10));
    const receivableIds = new Set(expense.shares.map((share) => share.receivableId));
    this.sharedExpenses.update((list) => list.map((item) => (item.id === id ? { ...item, expenseDate: date } : item)));
    this.receivables.update((list) =>
      list.map((item) => (receivableIds.has(item.id) ? { ...item, borrowedOn: date, dueDayOfMonth: dueDay } : item)),
    );
    const saved = this.sharedExpenses().find((item) => item.id === id);
    if (saved) this.upsertSharedBill(saved);
  }

  addShare(expenseId: string, name: string, amount: number): boolean {
    const expense = this.sharedExpenses().find((item) => item.id === expenseId);
    const person = name.trim();
    const shareAmount = round2(Math.max(0, amount));
    if (!expense || !person || shareAmount <= 0) return false;
    const used = round2(expense.shares.reduce((sum, share) => sum + share.amount, 0));
    if (round2(used + shareAmount) > expense.totalAmount + 0.001) return false;
    const shareId = crypto.randomUUID();
    const receivableId = crypto.randomUUID();
    const billDate = /^\d{4}-\d{2}-\d{2}$/.test(expense.expenseDate) ? expense.expenseDate : todayIso();
    const share: SharedExpenseShare = { id: shareId, name: person, amount: shareAmount, paid: false, receivableId };
    const receivable: Receivable = {
      id: receivableId,
      name: person,
      totalDebt: shareAmount,
      amountReceived: 0,
      paymentAmount: shareAmount,
      terms: 1,
      dueDayOfMonth: Number(billDate.slice(8, 10)),
      borrowedOn: billDate,
      notes: `Share of ${expense.name}`,
      sharedExpenseId: expense.id,
      shareId,
    };
    this.sharedExpenses.update((list) =>
      list.map((item) => (item.id === expenseId ? { ...item, shares: [...item.shares, share] } : item)),
    );
    this.receivables.update((list) => [...list, receivable]);
    const saved = this.sharedExpenses().find((item) => item.id === expenseId);
    if (saved) this.upsertSharedBill(saved);
    return true;
  }

  setSharePaid(expenseId: string, shareId: string, paid: boolean, paidOn?: string): void {
    const expense = this.sharedExpenses().find((item) => item.id === expenseId);
    const share = expense?.shares.find((item) => item.id === shareId);
    if (!expense || !share) return;
    // The cutoff already carries only your share, so a paid share clears what the person owes without adding cutoff income.
    if (paid) {
      const date = paidOn || share.paidOn || todayIso();
      if (share.paid) {
        this.patchShare(expenseId, shareId, { paidOn: date });
        return;
      }
      this.patchShare(expenseId, shareId, { paid: true, paidOn: date, creditedOn: undefined, creditedAmount: undefined });
      this.receivables.update((list) =>
        list.map((item) => (item.id === share.receivableId ? { ...item, amountReceived: share.amount, totalDebt: share.amount } : item)),
      );
      return;
    }
    if (!share.paid) return;
    // Shares marked paid before this change added income to a cutoff; take that back when unchecking.
    if (share.creditedOn && share.creditedAmount) this.adjustSupplementary(share.creditedOn, -share.creditedAmount);
    const receivable = this.receivables().find((item) => item.id === share.receivableId);
    const restored = round2(Math.max(0, (receivable?.amountReceived ?? 0) - share.amount));
    this.patchShare(expenseId, shareId, { paid: false, paidOn: undefined, creditedOn: undefined, creditedAmount: undefined });
    this.receivables.update((list) =>
      list.map((item) => (item.id === share.receivableId ? { ...item, amountReceived: restored } : item)),
    );
  }

  removeShare(expenseId: string, shareId: string): void {
    const share = this.sharedExpenses().find((item) => item.id === expenseId)?.shares.find((item) => item.id === shareId);
    if (!share) return;
    this.detachShare(expenseId, shareId);
    this.receivables.update((list) => list.filter((item) => item.id !== share.receivableId));
    const saved = this.sharedExpenses().find((item) => item.id === expenseId);
    if (saved) this.upsertSharedBill(saved);
  }

  removeSharedExpense(id: string): void {
    const expense = this.sharedExpenses().find((item) => item.id === id);
    if (!expense) return;
    const receivableIds = new Set(expense.shares.map((share) => share.receivableId));
    for (const share of [...expense.shares]) this.detachShare(id, share.id);
    this.receivables.update((list) => list.filter((item) => !receivableIds.has(item.id)));
    this.sharedExpenses.update((list) => list.filter((item) => item.id !== id));
    if (expense.liabilityId) this.deleteLiability(expense.liabilityId);
  }

  private patchShare(expenseId: string, shareId: string, patch: Partial<SharedExpenseShare>): void {
    this.sharedExpenses.update((list) =>
      list.map((expense) => {
        if (expense.id !== expenseId) return expense;
        return {
          ...expense,
          shares: expense.shares.map((share) => (share.id === shareId ? { ...share, ...patch } : share)),
        };
      }),
    );
  }

  private detachShare(expenseId: string, shareId: string): void {
    const share = this.sharedExpenses().find((item) => item.id === expenseId)?.shares.find((item) => item.id === shareId);
    if (share?.paid && share.creditedOn && share.creditedAmount) this.adjustSupplementary(share.creditedOn, -share.creditedAmount);
    this.sharedExpenses.update((list) =>
      list.map((expense) =>
        expense.id === expenseId ? { ...expense, shares: expense.shares.filter((item) => item.id !== shareId) } : expense,
      ),
    );
  }

  private cutoffOnOrAfter(iso: string): string {
    const upcoming = this.paycheckCycles()
      .map((cycle) => cycle.cutoffDate)
      .filter((date) => date >= iso)
      .sort();
    if (upcoming.length > 0) return upcoming[0];
    const day = Number(iso.slice(8, 10));
    const next = [10, 15, 25, 30].find((value) => value >= day);
    if (next) return `${iso.slice(0, 8)}${String(next).padStart(2, '0')}`;
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const rolled = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return `${rolled.year}-${String(rolled.month).padStart(2, '0')}-10`;
  }

  private adjustSupplementary(date: string, delta: number): void {
    const amount = round2(delta);
    if (!amount) return;
    this.ensureCycle(date);
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) =>
        cycle.cutoffDate === date
          ? { ...cycle, supplementaryIncome: round2(Math.max(0, cycle.supplementaryIncome + amount)) }
          : cycle,
      ),
    );
  }

  /** Makes sure this month and last month have 10th, 15th, 25th, and 30th cutoffs, including October when that is the current month. */
  ensureCurrentMonthCutoffs(): void {
    const today = parseIsoDate(todayIso());
    const months = [
      { year: today.getFullYear(), month: today.getMonth() + 1 },
      { year: today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear(), month: today.getMonth() === 0 ? 12 : today.getMonth() },
    ];
    for (const item of months) {
      const start = `${item.year}-${String(item.month).padStart(2, '0')}-01`;
      for (const day of [10, 15, 25, 30]) this.ensureCycle(shiftMonth(start, 0, day));
    }
  }

  private ensureCycle(date: string): void {
    if (this.paycheckCycles().some((cycle) => cycle.cutoffDate === date)) return;
    const created: PaycheckCycle = {
      id: date,
      label: `${formatLongDate(date)} Cutoff`,
      cutoffDate: date,
      baseIncome: 0,
      supplementaryIncome: 0,
      carryOverFromPrevious: 0,
      sinkingFundReserved: 0,
      allocations: [],
    };
    this.paycheckCycles.update((cycles) => [...cycles, created].sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate)));
  }

  /** The bill on your cutoff is your share only: the total less what other people cover. */
  private upsertSharedBill(expense: SharedExpense): void {
    const dueDay = Number(expense.expenseDate.slice(8, 10)) || 1;
    const yours = round2(Math.max(0, expense.totalAmount - expense.shares.reduce((sum, share) => sum + share.amount, 0)));
    const people = expense.shares.length;
    const notes = people
      ? `Shared expense. Total ${formatPhp(expense.totalAmount)}, split with ${people} ${people === 1 ? 'person' : 'people'}.`
      : `Shared expense. Total ${formatPhp(expense.totalAmount)}.`;
    const current = expense.liabilityId ? this.liabilities().find((item) => item.id === expense.liabilityId) : undefined;
    const liabilityId = current?.id ?? crypto.randomUUID();
    if (!current) {
      const item: LiabilityItem = {
        id: liabilityId,
        name: expense.name,
        bankName: expense.name,
        category: 'LIVING_EXPENSE',
        totalBalance: 0,
        initialBalance: 0,
        originalBalance: 0,
        adjustments: [],
        monthlyAmortization: yours,
        dueDayOfMonth: dueDay,
        assignedCutoff: defaultCutoff(dueDay),
        remainingTerms: 1,
        originalTerms: 1,
        startDate: expense.expenseDate,
        endDate: expense.expenseDate,
        status: 'ACTIVE',
        priorityRank: this.liabilities().reduce((max, item) => Math.max(max, item.priorityRank), 0) + 1,
        notes,
      };
      this.liabilities.update((list) => [...list, item]);
      this.sharedExpenses.update((list) => list.map((item) => (item.id === expense.id ? { ...item, liabilityId } : item)));
    } else {
      this.liabilities.update((list) =>
        list.map((item) =>
          item.id === liabilityId
            ? {
                ...item,
                name: expense.name,
                bankName: expense.name,
                monthlyAmortization: yours,
                dueDayOfMonth: dueDay,
                assignedCutoff: defaultCutoff(dueDay),
                startDate: expense.expenseDate,
                endDate: expense.expenseDate,
                notes,
              }
            : item,
        ),
      );
    }
    this.placeSharedAllocation(liabilityId, expense, yours);
  }

  private placeSharedAllocation(liabilityId: string, expense: SharedExpense, amount: number): void {
    const paid = this.paycheckCycles().some((cycle) =>
      cycle.allocations.some((allocation) => allocation.liabilityId === liabilityId && allocation.isPaid),
    );
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => ({
        ...cycle,
        allocations: cycle.allocations.filter((allocation) => allocation.liabilityId !== liabilityId || allocation.isPaid),
      })),
    );
    if (paid) return;
    const cutoff = this.cutoffOnOrAfter(expense.expenseDate);
    this.ensureCycle(cutoff);
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) => {
        if (cycle.cutoffDate !== cutoff || cycle.allocations.some((allocation) => allocation.liabilityId === liabilityId)) return cycle;
        const allocation: CutoffAllocationItem = {
          id: `${cycle.id}:${liabilityId}`,
          liabilityId,
          name: expense.name,
          category: 'LIVING_EXPENSE',
          dueDate: expense.expenseDate,
          plannedAmount: amount,
          actualPaidAmount: 0,
          isPaid: false,
          countsAsTerm: false,
          paymentNote: 'Shared expense (your share)',
        };
        return { ...cycle, allocations: [...cycle.allocations, allocation] };
      }),
    );
  }

  /** Cutoff cycles for the bill's payday (10th, 15th, 25th, or 30th) over the same horizon salaries use. */
  private ensureAssignedCycles(item: LiabilityItem): void {
    const cycles = this.paycheckCycles();
    const known = new Set(cycles.map((cycle) => cycle.cutoffDate));
    for (const day of cutoffDays(item.assignedCutoff)) {
      for (const iso of salaryCutoffDates(day, cycles, todayIso())) {
        if (known.has(iso)) continue;
        this.ensureCycle(iso);
        known.add(iso);
      }
    }
  }

  private scheduleLiability(item: LiabilityItem, allMatching = true): string | undefined {
    const amount = round2(item.monthlyAmortization > 0 ? item.monthlyAmortization : item.totalBalance);
    if (amount <= 0) return undefined;
    const pair = cutoffDays(item.assignedCutoff);
    const split = item.assignedCutoff === 'BOTH' || item.assignedCutoff === '15_30';
    const planned = split && item.category === 'LIVING_EXPENSE' ? round2(amount / 2) : amount;
    const occurrences =
      item.remainingTerms && item.remainingTerms > 0
        ? item.remainingTerms
        : item.category === 'ONE_TIME_OLA'
          ? 1
          : allMatching
            ? 24
            : 1;
    this.ensureCurrentMonthCutoffs();
    this.ensureAssignedCycles(item);
    let added = 0;
    let firstCutoff: string | undefined;
    this.paycheckCycles.update((cycles) => {
      const next = structuredClone(cycles).sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate));
      for (const cycle of next) {
        if (added >= occurrences) break;
        if (!matchesCutoffDays(cycle.cutoffDate, pair)) continue;
        if (cycle.cutoffDate < item.startDate) continue;
        if (item.endDate && cycle.cutoffDate > item.endDate) continue;
        if (cycle.allocations.some((allocation) => allocation.liabilityId === item.id)) continue;
        const dueDate = dueDateForCutoff(cycle.cutoffDate, item.dueDayOfMonth, item.assignedCutoff);
        const allocation: CutoffAllocationItem = {
          id: `${cycle.id}:${item.id}`,
          liabilityId: item.id,
          name: item.name,
          category: item.category,
          dueDate,
          plannedAmount: planned,
          actualPaidAmount: 0,
          minimumDue: item.minimumDue,
          isPaid: false,
          countsAsTerm: item.remainingTerms != null,
          paymentNote: 'Added from Debts / Expenses',
        };
        cycle.allocations.push(allocation);
        added += 1;
        firstCutoff ??= cycle.cutoffDate;
      }
      return next;
    });
    return firstCutoff;
  }

  private applyPayment(allocation: CutoffAllocationItem, liabilities: LiabilityItem[], amount: number): void {
    const liability = liabilities.find((item) => item.id === allocation.liabilityId);
    if (!liability || liability.category === 'LIVING_EXPENSE') return;
    allocation.appliedBalance = amount;
    liability.totalBalance = round2(Math.max(0, liability.totalBalance - amount));
    if (liability.totalBalance <= 0) {
      allocation.appliedStatus = liability.status;
      liability.totalBalance = 0;
      liability.status = 'PAID';
      allocation.clearedTerms = liability.remainingTerms ?? 0;
      if (liability.remainingTerms != null) liability.remainingTerms = 0;
      return;
    }
    if (allocation.countsAsTerm && (liability.remainingTerms ?? 0) > 0) {
      liability.remainingTerms = (liability.remainingTerms ?? 0) - 1;
      allocation.appliedTerm = true;
    }
  }

  private reversePayment(allocation: CutoffAllocationItem, liabilities: LiabilityItem[]): void {
    const liability = liabilities.find((item) => item.id === allocation.liabilityId);
    if (liability && liability.category !== 'LIVING_EXPENSE') {
      liability.totalBalance = round2(liability.totalBalance + (allocation.appliedBalance ?? allocation.actualPaidAmount));
      if (allocation.appliedTerm && liability.remainingTerms != null) liability.remainingTerms += 1;
      if (allocation.clearedTerms && liability.remainingTerms != null) liability.remainingTerms += allocation.clearedTerms;
      if (allocation.appliedStatus) liability.status = allocation.appliedStatus;
    }
    allocation.appliedBalance = undefined;
    allocation.appliedTerm = undefined;
    allocation.clearedTerms = undefined;
    allocation.appliedStatus = undefined;
  }

  private syncPaidStatus(liability: LiabilityItem, allocation: CutoffAllocationItem): void {
    if (liability.totalBalance <= 0) {
      liability.totalBalance = 0;
      if (liability.status !== 'PAID') {
        allocation.appliedStatus = liability.status;
        liability.status = 'PAID';
      }
      return;
    }
    if (liability.status === 'PAID' && allocation.appliedStatus) {
      liability.status = allocation.appliedStatus;
      allocation.appliedStatus = undefined;
    }
  }

  private payoffDate(item: LiabilityItem): string | null {
    if (item.category === 'LIVING_EXPENSE') return null;
    if (item.totalBalance <= 0 || item.status === 'PAID') return item.endDate ?? item.startDate;
    let covered = 0;
    for (const cycle of this.paycheckCycles()) {
      for (const allocation of cycle.allocations) {
        if (allocation.liabilityId !== item.id || allocation.isPaid) continue;
        covered = round2(covered + allocation.plannedAmount);
        if (covered + 0.01 >= item.totalBalance) return cycle.cutoffDate;
      }
    }
    return item.endDate ?? termEnd(item);
  }

  private nextDueDate(item: LiabilityItem, anchor: Date): string {
    if (item.endDate && (item.category === 'PAST_DUE_OLA' || item.startDate > toIso(anchor))) {
      const start = parseIsoDate(item.startDate);
      if (start >= anchor) return item.startDate;
    }
    const dueDay = Math.min(31, Math.max(1, item.dueDayOfMonth));
    let cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    for (let step = 0; step < 18; step += 1) {
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(dueDay, last));
      const iso = toIso(candidate);
      if (candidate >= anchor && iso >= item.startDate && (!item.endDate || iso <= item.endDate)) return iso;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return item.endDate && item.endDate >= item.startDate ? item.endDate : item.startDate;
  }

  private suggestedPayment(item: LiabilityItem): number {
    if (item.category === 'LIVING_EXPENSE') {
      return item.splitAcrossCutoffs ? round2(item.monthlyAmortization / 2) : item.monthlyAmortization;
    }
    if (item.monthlyAmortization > 0 && item.monthlyAmortization >= item.totalBalance - 0.01) {
      return round2(item.totalBalance);
    }
    if (item.minimumDue && item.minimumDue > 0 && item.minimumDue < item.totalBalance) return item.minimumDue;
    if (item.monthlyAmortization > 0) return round2(Math.min(item.monthlyAmortization, item.totalBalance));
    return round2(item.totalBalance);
  }
}

function normalizeDueDay(day: number | undefined): number | undefined {
  if (day == null || !Number.isFinite(day) || day < 1) return undefined;
  return Math.min(31, Math.max(1, Math.round(day)));
}

function activeInMonth(item: LiabilityItem, iso: string): boolean {
  if (item.status === 'PAID') return false;
  const month = iso.slice(0, 7);
  if (item.startDate.slice(0, 7) > month) return false;
  if (item.endDate && item.endDate.slice(0, 7) < month) return false;
  return true;
}

function termEnd(item: LiabilityItem): string | null {
  if (!item.remainingTerms || item.remainingTerms < 1) return null;
  return shiftMonth(item.startDate, item.remainingTerms - 1, item.dueDayOfMonth);
}

function inflowActive(stream: IncomeStream, onDate: string): boolean {
  const months = stream.remainingMonths ?? 0;
  if (months <= 0) return false;
  return onDate <= shiftMonth(todayIso(), Math.max(0, months - 1), stream.dayOfMonth);
}

function monthlyIncomeOn(streams: IncomeStream[], onDate: string): number {
  const salary = streams
    .filter((stream) => isSalaryCutoff(stream.cutoffType))
    .reduce((sum, stream) => sum + stream.amount, 0);
  const extra = streams
    .filter((stream) => stream.cutoffType === '30TH_INFLOW' && inflowActive(stream, onDate))
    .reduce((sum, stream) => sum + stream.amount, 0);
  return round2(salary + extra);
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

function describePlan(streams: IncomeStream[], owed: Receivable[], liabilities: LiabilityItem[]): string {
  if (streams.length === 0 && owed.length === 0 && liabilities.length === 0) {
    return 'Import your plan to see salary, people who owe you, and payoff dates.';
  }
  const bits: string[] = [];
  const salaryDays = [
    ...new Set(
      streams
        .filter((stream) => isSalaryCutoff(stream.cutoffType))
        .map((stream) => ordinalDay(stream.dayOfMonth)),
    ),
  ];
  if (salaryDays.length) bits.push(`Salary on the ${joinAnd(salaryDays)}`);
  for (const person of owed) {
    const when = person.dueDayOfMonth ? ` on the ${ordinalDay(person.dueDayOfMonth)}` : '';
    const months = person.terms === 1 ? '1 month' : `${person.terms} months`;
    bits.push(`${person.name} owes you ${formatPhp(person.paymentAmount)}${when} for ${months}`);
  }
  for (const stream of streams) {
    if (stream.cutoffType === '30TH_INFLOW' && owed.length) continue;
    if (isSalaryCutoff(stream.cutoffType) || stream.cutoffType === 'CASH_ADVANCE') continue;
    const when = stream.specificDate ? formatLongDate(stream.specificDate) : `the ${ordinalDay(stream.dayOfMonth)}`;
    bits.push(`${stream.name} on ${when}`);
  }
  const debts = liabilities.filter((item) => item.category !== 'LIVING_EXPENSE' && item.totalBalance > 0);
  const matched: string[] = [];
  if (debts.some((item) => item.category === 'FIXED_LOAN')) matched.push('loans');
  if (debts.some((item) => item.category === 'REVOLVING_CC')) matched.push('cards');
  for (const item of debts.filter((entry) => entry.category === 'PERSONAL_DEBT')) matched.push(item.name);
  const sentence = bits.join(', ');
  if (!sentence) return 'Your saved plan is in the database.';
  if (!matched.length) return `${sentence}.`;
  return `${sentence} — matched to ${joinAnd(matched)}.`;
}

const SALARY_CUTOFFS = new Set(['10TH_CUTOFF', '15TH_CUTOFF', '25TH_CUTOFF', '30TH_CUTOFF']);

function isSalaryCutoff(type: string): boolean {
  return SALARY_CUTOFFS.has(type);
}

function cycleMatchesSalaryDay(iso: string, day: number): boolean {
  return matchesCutoffDays(iso, [day]);
}

function nextDayOnOrAfter(anchor: string, day: number): string {
  const sameMonth = shiftMonth(anchor, 0, day);
  return sameMonth >= anchor ? sameMonth : shiftMonth(anchor, 1, day);
}

function salaryCutoffDates(day: number, cycles: PaycheckCycle[], today: string): string[] {
  const start = parseIsoDate(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const last = cycles.reduce((max, cycle) => (cycle.cutoffDate > max ? cycle.cutoffDate : max), '');
  const lastMonth = last ? parseIsoDate(last) : start;
  const end = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
  const floor = new Date(start.getFullYear(), start.getMonth() + 12, 1);
  const endMonth = end > floor ? end : floor;
  const dates: string[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= endMonth) {
    const iso = shiftMonth(toIso(cursor), 0, day);
    if (iso >= monthStart) dates.push(iso);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return dates;
}
