import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CATEGORY_META, cutoffDays, defaultCutoff } from '../core/categories';
import { daysBetween, formatLongDate, formatMonthYear, ordinalDay, parseIsoDate, shiftMonth, today, todayIso, toIso } from '../core/dates';
import { snapshotFromImport } from '../core/finance-export';
import { formatPhp, round2 } from '../core/money';
import { GIRLIE_ID, cloneSnapshot, dueDateForCutoff } from '../data/seed-data';
import { AuthService } from './auth.service';
import {
  AssignedCutoff,
  BankSaving,
  BudgetSnapshot,
  CutoffAllocationItem,
  CutoffWithdrawal,
  DebtSlice,
  FreeCashStep,
  IncomeStream,
  ItemStatus,
  LiabilityCategory,
  LiabilityItem,
  Milestone,
  PaycheckCycle,
  Receivable,
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
  readonly loaded = signal(false);
  readonly saveError = signal('');

  readonly otherBankSavings = computed(() => round2(this.bankSavings().reduce((sum, item) => sum + Math.max(0, item.amount), 0)));

  readonly totalSavings = computed(() => this.otherBankSavings());

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
  }

  async hydrate(): Promise<void> {
    this.acceptSaves = false;
    const snapshot = await firstValueFrom(this.http.get<BudgetSnapshot>('/api/plan', { headers: this.auth.headers() }));
    this.applySnapshot(snapshot);
    this.loaded.set(true);
    this.acceptSaves = true;
    this.saveError.set('');
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
    if (typeof snapshot.hideDebtTotal === 'boolean') this.hideDebtTotal.set(snapshot.hideDebtTotal);
    if (typeof snapshot.hideSavingsTotal === 'boolean') this.hideSavingsTotal.set(snapshot.hideSavingsTotal);
    if (typeof snapshot.revision === 'number' && snapshot.revision > this.revision) this.revision = snapshot.revision;
  }

  cycleInflow(cycle: PaycheckCycle): number {
    return round2(cycle.baseIncome + cycle.supplementaryIncome + cycle.carryOverFromPrevious);
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
      amount,
      withdrawnOn: todayIso(),
      note: draft.note?.trim() || undefined,
    };
    this.withdrawals.update((list) => [...list, entry]);
  }

  removeWithdrawal(id: string): void {
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
      for (const item of salaries) lines.push({ id: item.id, name: item.name, amount: item.amount, kind: 'salary' });
    } else if (cycle.baseIncome > 0) {
      lines.push({ id: `${cycle.id}-base`, name: 'Income', amount: cycle.baseIncome, kind: 'other' });
    }

    const bonus = this.otherIncome().find((stream) => stream.specificDate === cycle.cutoffDate);
    const owed =
      this.receivables().find((item) => item.dueDayOfMonth != null && cycleMatchesSalaryDay(cycle.cutoffDate, item.dueDayOfMonth)) ??
      (day === 25 ? this.receivableForCutoff() : undefined);
    if (bonus && cycle.supplementaryIncome > 0) {
      lines.push({ id: bonus.id, name: bonus.name, amount: cycle.supplementaryIncome, kind: 'other' });
    } else if (owed && cycle.supplementaryIncome > 0) {
      lines.push({ id: owed.id, name: owed.name, amount: cycle.supplementaryIncome, kind: 'owe' });
    } else if (cycle.supplementaryIncome > 0) {
      const inflow = this.incomeStreams().find((stream) => stream.cutoffType === '30TH_INFLOW');
      lines.push({
        id: inflow?.id ?? `${cycle.id}-extra`,
        name: inflow?.name ?? 'Other income',
        amount: cycle.supplementaryIncome,
        kind: inflow ? 'owe' : 'other',
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

  addLiability(draft: LiabilityDraft): void {
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
    if (draft.addToFutureCutoffs !== false && item.monthlyAmortization > 0) {
      this.scheduleLiability(item);
    }
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

  addIncomeStream(draft: {
    name: string;
    amount: number;
    cutoffType: IncomeStream['cutoffType'];
    dayOfMonth: number;
    remainingMonths?: number;
    isOneTime?: boolean;
    specificDate?: string;
  }): void {
    const stream: IncomeStream = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      amount: round2(Math.max(0, draft.amount)),
      dayOfMonth: Math.min(31, Math.max(1, Math.round(draft.dayOfMonth))),
      cutoffType: draft.cutoffType,
      remainingMonths: draft.remainingMonths,
      isOneTime: draft.isOneTime,
      specificDate: draft.specificDate,
    };
    this.incomeStreams.update((list) => [...list, stream]);
    this.applyStreamToCycles(stream);
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
    },
  ): void {
    const current = this.incomeStreams().find((stream) => stream.id === id);
    if (!current) return;
    const next: IncomeStream = {
      ...current,
      name: patch.name?.trim() || current.name,
      amount: patch.amount != null ? round2(Math.max(0, patch.amount)) : current.amount,
      dayOfMonth: patch.dayOfMonth != null ? Math.min(31, Math.max(1, Math.round(patch.dayOfMonth))) : current.dayOfMonth,
      cutoffType: patch.cutoffType ?? current.cutoffType,
      remainingMonths: patch.remainingMonths != null ? Math.max(0, Math.round(patch.remainingMonths)) : current.remainingMonths,
      specificDate: patch.specificDate !== undefined ? patch.specificDate || undefined : current.specificDate,
    };
    this.incomeStreams.update((list) => list.map((stream) => (stream.id === id ? next : stream)));
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
  }

  removeIncome(id: string): void {
    const current = this.incomeStreams().find((stream) => stream.id === id);
    if (!current) return;
    this.incomeStreams.update((list) => list.filter((stream) => stream.id !== id));
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

  applyOwedPayment(payment: number, dueDay: number | undefined): void {
    const amount = round2(Math.max(0, payment));
    if (amount <= 0) return;
    this.creditOwedPayment({ name: 'Payment', dueDayOfMonth: dueDay }, amount);
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
    });
    this.flushSave();
  }

  addBankSaving(draft: { bankName: string; accountName: string; amount: number; notes?: string }): void {
    const saving: BankSaving = {
      id: crypto.randomUUID(),
      bankName: draft.bankName.trim(),
      accountName: draft.accountName.trim() || 'Savings',
      amount: round2(Math.max(0, draft.amount)),
      notes: draft.notes?.trim() || undefined,
    };
    this.bankSavings.update((list) => [...list, saving]);
  }

  updateBankSaving(id: string, patch: Partial<Pick<BankSaving, 'bankName' | 'accountName' | 'amount' | 'notes'>>): void {
    this.bankSavings.update((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          bankName: patch.bankName?.trim() || item.bankName,
          accountName: patch.accountName?.trim() || item.accountName,
          amount: patch.amount != null ? round2(Math.max(0, patch.amount)) : item.amount,
          notes: patch.notes != null ? patch.notes.trim() || undefined : item.notes,
        };
      }),
    );
  }

  removeBankSaving(id: string): void {
    this.bankSavings.update((list) => list.filter((item) => item.id !== id));
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

  recordReceivablePayment(id: string, amount: number): string {
    const payment = round2(Math.max(0, amount));
    const current = this.receivables().find((item) => item.id === id);
    if (!current || payment <= 0) return '';
    const remaining = round2(Math.max(0, current.totalDebt - current.amountReceived));
    const applied = round2(Math.min(payment, remaining));
    if (applied <= 0) return '';
    this.receivables.update((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        return { ...item, amountReceived: round2(item.amountReceived + applied) };
      }),
    );
    const cutoffDate = this.creditOwedPayment(current, applied);
    const updated = this.receivables().find((item) => item.id === id);
    if (
      updated?.sharedExpenseId &&
      updated.shareId &&
      updated.amountReceived + 0.001 >= updated.totalDebt
    ) {
      this.sharedExpenses.update((expenses) =>
        expenses.map((expense) => {
          if (expense.id !== updated.sharedExpenseId) return expense;
          return {
            ...expense,
            shares: expense.shares.map((share) =>
              share.id === updated.shareId && !share.paid
                ? { ...share, paid: true, paidOn: todayIso(), creditedOn: cutoffDate, creditedAmount: applied }
                : share,
            ),
          };
        }),
      );
    }
    const when = current.dueDayOfMonth ? `the ${ordinalDay(current.dueDayOfMonth)} cutoff` : 'the next cutoff';
    return `${current.name}'s payment of ${formatPhp(applied)} was added to ${when}${cutoffDate ? ` (${formatLongDate(cutoffDate)})` : ''}.`;
  }

  private creditOwedPayment(item: { name: string; dueDayOfMonth?: number }, amount: number): string {
    const anchor = todayIso();
    const targetDate = item.dueDayOfMonth ? nextDayOnOrAfter(anchor, item.dueDayOfMonth) : anchor;
    if (!this.paycheckCycles().some((cycle) => cycle.cutoffDate === targetDate)) {
      const created: PaycheckCycle = {
        id: targetDate,
        label: `${formatLongDate(targetDate)} Cutoff`,
        cutoffDate: targetDate,
        baseIncome: 0,
        supplementaryIncome: 0,
        carryOverFromPrevious: 0,
        sinkingFundReserved: 0,
        allocations: [],
      };
      this.paycheckCycles.update((cycles) => [...cycles, created].sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate)));
    }
    this.paycheckCycles.update((cycles) =>
      cycles.map((cycle) =>
        cycle.cutoffDate === targetDate ? { ...cycle, supplementaryIncome: round2(cycle.supplementaryIncome + amount) } : cycle,
      ),
    );
    return targetDate;
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
    if (paid) {
      const date = paidOn || share.paidOn || todayIso();
      const cutoff = this.cutoffOnOrAfter(date);
      if (share.paid && share.creditedOn === cutoff) {
        this.patchShare(expenseId, shareId, { paidOn: date });
        return;
      }
      if (share.paid && share.creditedOn && share.creditedAmount) {
        this.adjustSupplementary(share.creditedOn, -share.creditedAmount);
        this.adjustSupplementary(cutoff, share.creditedAmount);
        this.patchShare(expenseId, shareId, { paid: true, paidOn: date, creditedOn: cutoff });
        return;
      }
      const receivable = this.receivables().find((item) => item.id === share.receivableId);
      const already = receivable?.amountReceived ?? 0;
      const due = round2(Math.max(0, share.amount - already));
      if (due > 0) this.adjustSupplementary(cutoff, due);
      this.patchShare(expenseId, shareId, { paid: true, paidOn: date, creditedOn: cutoff, creditedAmount: due });
      this.receivables.update((list) =>
        list.map((item) => (item.id === share.receivableId ? { ...item, amountReceived: share.amount, totalDebt: share.amount } : item)),
      );
      return;
    }
    if (!share.paid) return;
    if (share.creditedOn && share.creditedAmount) this.adjustSupplementary(share.creditedOn, -share.creditedAmount);
    const receivable = this.receivables().find((item) => item.id === share.receivableId);
    const restored = round2(Math.max(0, (receivable?.amountReceived ?? 0) - (share.creditedAmount ?? 0)));
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

  private upsertSharedBill(expense: SharedExpense): void {
    const dueDay = Number(expense.expenseDate.slice(8, 10)) || 1;
    const yours = round2(Math.max(0, expense.totalAmount - expense.shares.reduce((sum, share) => sum + share.amount, 0)));
    const notes = expense.shares.length
      ? `Shared expense. Your share is ${formatPhp(yours)}.`
      : 'Shared expense.';
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
        monthlyAmortization: expense.totalAmount,
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
                monthlyAmortization: expense.totalAmount,
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
    this.placeSharedAllocation(liabilityId, expense);
  }

  private placeSharedAllocation(liabilityId: string, expense: SharedExpense): void {
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
          plannedAmount: expense.totalAmount,
          actualPaidAmount: 0,
          isPaid: false,
          countsAsTerm: false,
          paymentNote: 'Shared expense',
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

  private scheduleLiability(item: LiabilityItem): void {
    const occurrences = item.remainingTerms && item.remainingTerms > 0 ? item.remainingTerms : item.category === 'LIVING_EXPENSE' ? 24 : 1;
    this.ensureAssignedCycles(item);
    let added = 0;
    this.paycheckCycles.update((cycles) => {
      const next = structuredClone(cycles).sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate));
      for (const cycle of next) {
        if (added >= occurrences) break;
        const matches = cutoffDays(item.assignedCutoff).some((day) => cycleMatchesSalaryDay(cycle.cutoffDate, day));
        if (!matches) continue;
        const dueDate = dueDateForCutoff(cycle.cutoffDate, item.dueDayOfMonth, item.assignedCutoff);
        if (dueDate < item.startDate) continue;
        if (item.endDate && dueDate > item.endDate) continue;
        if (cycle.allocations.some((allocation) => allocation.liabilityId === item.id && allocation.dueDate === dueDate)) continue;
        const allocation: CutoffAllocationItem = {
          id: `${cycle.id}:${item.id}`,
          liabilityId: item.id,
          name: item.name,
          category: item.category,
          dueDate,
          plannedAmount: item.monthlyAmortization,
          actualPaidAmount: 0,
          minimumDue: item.minimumDue,
          isPaid: false,
          countsAsTerm: item.remainingTerms != null,
          paymentNote: 'Added from the debt inventory',
        };
        cycle.allocations.push(allocation);
        added += 1;
      }
      return next;
    });
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
  const date = parseIsoDate(iso);
  const actual = date.getDate();
  if (actual === day) return true;
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return day > last && actual === last;
}

function nextDayOnOrAfter(anchor: string, day: number): string {
  const sameMonth = shiftMonth(anchor, 0, day);
  return sameMonth >= anchor ? sameMonth : shiftMonth(anchor, 1, day);
}

function salaryCutoffDates(day: number, cycles: PaycheckCycle[], today: string): string[] {
  const start = parseIsoDate(today);
  const last = cycles.reduce((max, cycle) => (cycle.cutoffDate > max ? cycle.cutoffDate : max), '');
  const lastMonth = last ? parseIsoDate(last) : start;
  const end = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
  const floor = new Date(start.getFullYear(), start.getMonth() + 12, 1);
  const endMonth = end > floor ? end : floor;
  const dates: string[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= endMonth) {
    const iso = shiftMonth(toIso(cursor), 0, day);
    if (iso >= today) dates.push(iso);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return dates;
}
