import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideCheck, LucidePiggyBank, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { CATEGORY_META } from '../../core/categories';
import { formatLongDate, formatShortDate, todayIso } from '../../core/dates';
import { parseMoney, round2 } from '../../core/money';
import { CutoffAllocationItem, PaycheckCycle } from '../../models/budget.model';
import { BudgetStateService, CutoffIncomeLine } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PhpPipe } from '../../shared/php.pipe';

@Component({
  selector: 'app-cutoff-planner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, RouterLink, PhpPipe, ModalComponent, LucideCheck, LucidePiggyBank, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Salary cutoff payments</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Payments</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Check a bill when you pay it. Money comes out of the bank or e-wallet this cutoff's salary was deposited to. If that balance is short, split the rest to another source.
      </p>
    </section>

    <label class="mt-5 block max-w-md text-xs text-slate-400">
      Cutoff
      <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" (change)="selectedId.set(choice($event))">
        @for (group of cutoffGroups(); track group.year) {
          <optgroup [label]="group.year">
            @for (cycle of group.rows; track cycle.id) {
              <option [value]="cycle.id" [selected]="selected().id === cycle.id">
                {{ longDate(cycle.cutoffDate) }} · {{ paidCount(cycle) }}/{{ cycle.allocations.length }} paid
              </option>
            }
          </optgroup>
        }
      </select>
    </label>

    @if (budget.paycheckCycles().length === 0) {
      <p class="mt-4 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
        No cutoffs yet. Import your financial plan from Settings.
      </p>
    }

    @if (selected(); as cycle) {
      <section class="mt-4 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-bold">{{ incomeHeading(cycle) }}</h2>
            <p class="mt-1 text-sm text-slate-400">{{ paidCount(cycle) }} of {{ cycle.allocations.length }} marked paid · {{ budget.cyclePaid(cycle) | php }} out the door</p>
          </div>
          <div class="text-right">
            <p class="font-mono text-lg" [class.text-rose-300]="isNegative(budget.cycleRemaining(cycle))" [class.text-emerald-300]="!isNegative(budget.cycleRemaining(cycle))">
              {{ budget.cycleRemaining(cycle) | php }} remaining
            </p>
            <p class="text-xs text-slate-400">{{ budget.cycleUnallocated(cycle) | php }} unallocated after planned bills</p>
          </div>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          @for (line of budget.cutoffIncomeLines(cycle); track line.id) {
            <div class="rounded-2xl px-3 py-2" [ngClass]="line.kind === 'carry' ? 'bg-violet-400/10' : line.kind === 'owe' ? 'bg-sky-400/10' : 'bg-white/5'">
              <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">{{ incomeKind(line.kind) }}{{ line.expected != null ? ' · received' : '' }}</p>
              <p class="mt-1 text-sm font-semibold">{{ line.name }}</p>
              <p class="font-mono text-sm">{{ line.amount | php }}</p>
              @if (line.expected != null) {
                <p class="text-[11px] text-slate-400">{{ line.expected | php }} expected</p>
              }
              @if (line.kind === 'salary') {
                <p class="text-[11px] text-slate-400">
                  @if (budget.accountLabel(line.accountId); as label) {
                    {{ label }}
                  } @else {
                    Not linked yet
                  }
                  @if (cycle.cutoffDate <= today) {
                    · <a routerLink="/income" class="font-semibold text-emerald-300">Log amount received</a>
                  }
                </p>
              }
            </div>
          }
          <div class="rounded-2xl bg-white/5 px-3 py-2">
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">− Planned</p>
            <p class="font-mono text-sm">{{ budget.cyclePlanned(cycle) | php }}</p>
          </div>
          <div class="rounded-2xl bg-white/5 px-3 py-2">
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">− Reserve</p>
            <p class="font-mono text-sm">{{ cycle.sinkingFundReserved | php }}</p>
          </div>
          <div class="rounded-2xl px-3 py-2" [ngClass]="isNegative(budget.cycleUnallocated(cycle)) ? 'bg-rose-400/15' : 'bg-emerald-400/15'">
            <p class="text-[11px] uppercase tracking-[0.14em]">= Unallocated</p>
            <p class="font-mono text-sm font-semibold">{{ budget.cycleUnallocated(cycle) | php }}</p>
          </div>
        </div>

        <div class="mt-3 grid gap-2 rounded-2xl border border-white/10 p-3 sm:grid-cols-4">
          <div>
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">Received</p>
            <p class="font-mono text-sm">{{ budget.cycleInflow(cycle) | php }}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">− Paid</p>
            <p class="font-mono text-sm">{{ budget.cyclePaid(cycle) | php }}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">− Withdrawn</p>
            <p class="font-mono text-sm">{{ budget.withdrawnFor(cycle.id) | php }}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">= Remaining</p>
            <p class="font-mono text-sm font-semibold" [class.text-rose-300]="isNegative(budget.cycleRemaining(cycle))" [class.text-emerald-300]="!isNegative(budget.cycleRemaining(cycle))">
              {{ budget.cycleRemaining(cycle) | php }}
            </p>
          </div>
          <p class="text-xs text-slate-500 sm:col-span-4">Each bill you tick paid comes off this remaining amount, and off the bank or cash you paid it from.</p>
        </div>
      </section>

      <section class="mt-4 rounded-3xl border border-violet-400/20 bg-violet-400/10 p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-start gap-3">
            <span class="grid h-10 w-10 place-items-center rounded-2xl bg-violet-300 text-slate-950">
              <svg lucidePiggyBank [size]="18"></svg>
            </span>
            <div>
              <h3 class="font-bold">Sinking fund reserved</h3>
              <p class="text-sm text-violet-100/80">
                @if (nextCycle(); as upcoming) {
                  This becomes the carry-over on {{ shortDate(upcoming.cutoffDate) }}.
                } @else {
                  This is the last cutoff in the plan.
                }
              </p>
            </div>
          </div>
          <label class="text-sm">
            <span class="sr-only">Sinking fund reserved</span>
            <input
              class="w-36 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-right font-mono"
              type="number"
              min="0"
              step="0.01"
              [value]="cycle.sinkingFundReserved"
              (change)="setReserve(cycle, $event)"
            />
          </label>
        </div>
        <input
          class="mt-4 w-full accent-violet-300"
          type="range"
          min="0"
          [max]="reserveMax(cycle)"
          step="0.01"
          [value]="cycle.sinkingFundReserved"
          aria-label="Sinking fund slider"
          (input)="setReserve(cycle, $event)"
        />
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="rounded-full border border-white/15 px-3 py-1.5 text-sm" (click)="holdLeftover(cycle)">Hold the leftover</button>
          <button type="button" class="rounded-full border border-white/15 px-3 py-1.5 text-sm" (click)="budget.setSinkingFund(cycle.id, 0)">Release reserve</button>
        </div>
        @if (isNegative(budget.cycleUnallocated(cycle))) {
          <p class="mt-3 text-sm text-rose-200">This cutoff is short {{ (budget.cycleUnallocated(cycle) * -1) | php }}. Lower a planned amount or the reserve.</p>
        }
      </section>

      <ul class="mt-4 space-y-3">
        @for (item of cycle.allocations; track item.id) {
          <li class="rounded-3xl border border-white/10 bg-slate-900/70 p-4" [class.opacity-70]="item.isPaid">
            <div class="flex items-start gap-3">
              <button
                type="button"
                class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border"
                [ngClass]="item.isPaid ? 'border-emerald-300 bg-emerald-300 text-slate-950' : 'border-white/20'"
                [attr.aria-pressed]="item.isPaid"
                [attr.aria-label]="(item.isPaid ? 'Mark unpaid: ' : 'Mark paid: ') + item.name"
                (click)="onPaidClick(cycle, item)"
              >
                @if (item.isPaid) {
                  <svg lucideCheck [size]="16"></svg>
                }
              </button>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-semibold">{{ item.name }}</h3>
                  <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset" [class]="categoryMeta[item.category].badgeClass">
                    {{ categoryMeta[item.category].label }}
                  </span>
                  @if (item.shareId && item.isPaid) {
                    <span class="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-200">Covered · not from savings</span>
                  } @else if (item.isPaid) {
                    <span class="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                      Paid{{ item.paymentSource ? ' · ' + item.paymentSource : '' }}
                    </span>
                  }
                </div>
                <p class="mt-1 text-sm text-slate-400">Due {{ shortDate(item.dueDate) }}@if (item.paymentNote) { · {{ item.paymentNote }} }</p>
              </div>
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <label class="block text-xs text-slate-400">
                Planned amount
                <input
                  class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white disabled:opacity-60"
                  type="number"
                  min="0"
                  step="0.01"
                  [disabled]="item.isPaid"
                  [value]="item.plannedAmount"
                  (change)="updateAmount(cycle.id, item.id, 'plannedAmount', $event)"
                />
              </label>
              <label class="block text-xs text-slate-400">
                Actual paid
                <input
                  class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                  type="number"
                  min="0"
                  step="0.01"
                  [value]="item.actualPaidAmount || ''"
                  placeholder="0.00"
                  (change)="updateAmount(cycle.id, item.id, 'actualPaidAmount', $event)"
                />
              </label>
            </div>
          </li>
        }
      </ul>
    }

    <app-modal [open]="paying() !== null" size="lg" (closed)="paying.set(null)">
      @if (paying(); as pay) {
        <h2 class="text-xl font-bold">How did you pay {{ pay.item.name }}?</h2>
        <p class="mt-1 text-sm text-slate-400">Due {{ shortDate(pay.item.dueDate) }} · {{ shortDate(pay.cycle.cutoffDate) }} cutoff</p>
        <label class="mt-4 block text-sm">
          Amount paid
          <input
            class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono"
            type="number"
            min="0"
            step="0.01"
            [value]="payAmount()"
            (input)="onPayTotal($event)"
          />
        </label>
        <p class="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Paid from</p>
        <p class="mt-1 text-xs text-slate-500">The first source is this cutoff's salary bank or e-wallet. If that balance is short, add another row for the rest.</p>
        <div class="mt-2 space-y-2">
          @for (row of payRows(); track $index; let i = $index) {
            <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div class="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
                <label class="text-xs text-slate-400">
                  Source
                  <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="setPayRow(i, 'key', choice($event))">
                    @if (depositAccountId(pay.cycle); as salaryId) {
                      @if (row.key === salaryId || !sourceUsed(salaryId, i)) {
                        <option [value]="salaryId" [selected]="row.key === salaryId">Salary cutoff · {{ budget.accountLabel(salaryId) }} · {{ budget.accountBalance(salaryId) | php }}</option>
                      }
                    }
                    @if (depositAccountId(pay.cycle) !== 'cash' && (row.key === 'cash' || !sourceUsed('cash', i))) {
                      <option value="cash" [selected]="row.key === 'cash'">Cash on hand · {{ budget.cashOnHand() | php }}</option>
                    }
                    @for (account of otherPayAccounts(pay.cycle, i); track account.id) {
                      <option [value]="account.id" [selected]="row.key === account.id">{{ budget.accountLabel(account.id) }} · {{ budget.accountBalance(account.id) | php }}</option>
                    }
                  </select>
                </label>
                <label class="text-xs text-slate-400">
                  Portion
                  <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="row.amount" (input)="setPayRow(i, 'amount', text($event))" />
                </label>
                @if (i > 0) {
                  <button type="button" class="inline-flex items-center justify-center gap-1 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="removePayRow(i)">
                    <svg lucideTrash2 [size]="14"></svg> Remove
                  </button>
                }
              </div>
              @if (sourceBalance(row.key) <= 0) {
                <p class="mt-2 text-sm text-amber-200">This source has ₱0.00. Pick a different one, or set this portion to zero and add another source.</p>
              } @else if (rowAmount(row) > sourceBalance(row.key) + 0.001) {
                <p class="mt-2 text-sm text-amber-200">
                  This source only has {{ sourceBalance(row.key) | php }}. Use that portion here and add another source for the rest.
                </p>
                @if (canAddPayRow()) {
                  <button type="button" class="mt-2 rounded-xl border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100" (click)="useAvailableAndAdd(i)">
                    Use {{ sourceBalance(row.key) | php }} and add another source
                  </button>
                }
              }
            </div>
          }
        </div>
        @if (canAddPayRow()) {
          <button type="button" class="mt-3 inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm" (click)="addPayRow()">
            <svg lucidePlus [size]="14"></svg> Add another source
          </button>
        }
        <p class="mt-3 text-sm" [class.text-rose-200]="payGap() > 0.001 || payOverage() > 0.001" [class.text-emerald-200]="payGap() <= 0.001 && payOverage() <= 0.001">
          Covered {{ payCovered() | php }} of {{ payTotal() | php }}
          @if (payGap() > 0.001) {
            · {{ payGap() | php }} still uncovered
          }
          @if (payOverage() > 0.001) {
            · {{ payOverage() | php }} over the amount paid
          }
        </p>
        @if (budget.accounts().length === 0) {
          <p class="mt-3 text-sm text-slate-400">
            Register a bank or e-wallet on <a routerLink="/accounts" class="font-semibold text-emerald-300" (click)="paying.set(null)">Banks / E-Wallet</a> so this cutoff's salary can be deducted from it.
          </p>
        }
        @if (payError()) {
          <p class="mt-3 text-sm text-rose-200">{{ payError() }}</p>
        }
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="confirmPaid()">Mark paid</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="paying.set(null)">Cancel</button>
        </div>
      }
    </app-modal>
  `,
})
export class CutoffPlannerComponent {
  readonly budget = inject(BudgetStateService);
  readonly selectedId = signal<string | null>(null);
  readonly shortDate = formatShortDate;
  readonly longDate = formatLongDate;
  readonly today = todayIso();
  readonly categoryMeta = CATEGORY_META;
  readonly paying = signal<{ cycle: PaycheckCycle; item: CutoffAllocationItem } | null>(null);
  readonly payAmount = signal('');
  readonly payRows = signal<PayRow[]>([]);
  readonly payError = signal('');
  readonly payCovered = computed(() => round2(this.payRows().reduce((sum, row) => sum + parseMoney(row.amount), 0)));
  readonly payTotal = computed(() => parseMoney(this.payAmount()));
  readonly payGap = computed(() => round2(Math.max(0, this.payTotal() - this.payCovered())));
  readonly payOverage = computed(() => round2(Math.max(0, this.payCovered() - this.payTotal())));

  readonly selected = computed(() => {
    const cycles = this.budget.paycheckCycles();
    const chosen = this.selectedId();
    if (chosen) {
      const match = cycles.find((cycle) => cycle.id === chosen);
      if (match) return match;
    }
    const today = this.today;
    return (
      cycles.find((cycle) => cycle.cutoffDate >= today) ??
      [...cycles].reverse().find((cycle) => cycle.cutoffDate <= today) ??
      this.budget.upcomingCycle() ??
      cycles[0]
    );
  });

  readonly cutoffGroups = computed(() => {
    const groups: { year: string; rows: PaycheckCycle[] }[] = [];
    for (const cycle of this.budget.paycheckCycles()) {
      const year = cycle.cutoffDate.slice(0, 4);
      const current = groups.find((group) => group.year === year);
      if (current) current.rows.push(cycle);
      else groups.push({ year, rows: [cycle] });
    }
    return groups;
  });

  readonly nextCycle = computed(() => {
    const cycles = this.budget.paycheckCycles();
    const current = this.selected();
    const index = cycles.findIndex((cycle) => cycle.id === current?.id);
    return index >= 0 ? cycles[index + 1] : undefined;
  });

  constructor() {
    this.budget.ensureCurrentMonthCutoffs();
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const cycle = params.get('cycle');
        if (cycle) this.selectedId.set(cycle);
      });
  }

  incomeHeading(cycle: PaycheckCycle): string {
    const names = this.budget
      .cutoffIncomeLines(cycle)
      .filter((line) => line.kind !== 'carry')
      .map((line) => line.name);
    if (!names.length) return cycle.label;
    return `${formatShortDate(cycle.cutoffDate)} · ${names.join(' + ')}`;
  }

  incomeKind(kind: CutoffIncomeLine['kind']): string {
    if (kind === 'salary') return 'Salary cutoff';
    if (kind === 'owe') return 'Owes you';
    if (kind === 'carry') return 'Carry-over';
    return 'Other income';
  }

  isNegative(amount: number): boolean {
    return amount < 0;
  }

  depositAccountId(cycle: PaycheckCycle): string | undefined {
    return (
      this.budget.cutoffIncomeLines(cycle).find((line) => line.kind === 'salary' && line.accountId)?.accountId ??
      this.budget.payAccountFor(cycle)
    );
  }

  paidCount(cycle: PaycheckCycle): number {
    return cycle.allocations.filter((item) => item.isPaid).length;
  }

  reserveMax(cycle: PaycheckCycle): number {
    const room = Math.max(0, this.budget.cycleInflow(cycle) - this.budget.cyclePlanned(cycle));
    return Math.max(room, cycle.sinkingFundReserved);
  }

  setReserve(cycle: PaycheckCycle, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.budget.setSinkingFund(cycle.id, parseMoney(value));
  }

  holdLeftover(cycle: PaycheckCycle): void {
    const leftover = this.budget.cycleUnallocated(cycle);
    this.budget.setSinkingFund(cycle.id, cycle.sinkingFundReserved + Math.max(0, leftover));
  }

  updateAmount(cycleId: string, allocationId: string, field: 'plannedAmount' | 'actualPaidAmount', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.budget.updateAllocationAmount(cycleId, allocationId, field, parseMoney(value));
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  sourceBalance(key: string): number {
    return key === 'cash' ? this.budget.cashOnHand() : this.budget.accountBalance(key);
  }

  rowAmount(row: PayRow): number {
    return parseMoney(row.amount);
  }

  sourceUsed(key: string, index: number): boolean {
    return this.payRows().some((row, i) => i !== index && row.key === key);
  }

  otherPayAccounts(cycle: PaycheckCycle, index: number) {
    const salaryId = this.depositAccountId(cycle);
    return this.budget.accounts().filter((account) => account.id !== salaryId && (this.payRows()[index]?.key === account.id || !this.sourceUsed(account.id, index)));
  }

  canAddPayRow(): boolean {
    const cycle = this.paying()?.cycle;
    if (!cycle) return false;
    const used = new Set(this.payRows().map((row) => row.key));
    if (!used.has('cash')) return true;
    return this.budget.accounts().some((account) => !used.has(account.id));
  }

  nextPayKey(): string | undefined {
    const cycle = this.paying()?.cycle;
    if (!cycle) return undefined;
    const used = new Set(this.payRows().map((row) => row.key));
    const salaryId = this.depositAccountId(cycle);
    if (salaryId && !used.has(salaryId)) return salaryId;
    if (!used.has('cash')) return 'cash';
    return this.budget.accounts().find((account) => !used.has(account.id))?.id;
  }

  onPayTotal(event: Event): void {
    const value = this.text(event);
    this.payAmount.set(value);
    const total = parseMoney(value);
    const rows = this.payRows();
    if (rows.length === 1) {
      const cap = this.sourceBalance(rows[0].key);
      const portion = cap <= 0 ? 0 : Math.min(total, cap);
      this.payRows.set([{ ...rows[0], amount: portion > 0 ? String(round2(portion)) : '' }]);
    }
    this.payError.set('');
  }

  setPayRow(index: number, field: 'key' | 'amount', value: string): void {
    this.payRows.update((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    this.payError.set('');
  }

  addPayRow(): void {
    const key = this.nextPayKey();
    if (!key) return;
    const remaining = this.payGap();
    const available = this.sourceBalance(key);
    const portion = available <= 0 ? 0 : Math.min(remaining, available);
    this.payRows.update((rows) => [...rows, { key, amount: portion > 0 ? String(round2(portion)) : '' }]);
    this.payError.set('');
  }

  removePayRow(index: number): void {
    this.payRows.update((rows) => rows.filter((_, i) => i !== index));
    this.payError.set('');
  }

  useAvailableAndAdd(index: number): void {
    this.payRows.update((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const available = this.sourceBalance(row.key);
        return { ...row, amount: available > 0 ? String(round2(available)) : '0' };
      }),
    );
    this.addPayRow();
  }

  onPaidClick(cycle: PaycheckCycle, item: CutoffAllocationItem): void {
    if (item.shareId && item.sharedExpenseId) {
      this.budget.setSharePaid(item.sharedExpenseId, item.shareId, !item.isPaid);
      return;
    }
    if (item.isPaid) {
      this.budget.toggleAllocationPaid(cycle.id, item.id);
      return;
    }
    const amount = item.actualPaidAmount > 0 ? item.actualPaidAmount : item.plannedAmount;
    const salaryId = this.depositAccountId(cycle) ?? 'cash';
    const available = this.sourceBalance(salaryId);
    const portion = available <= 0 ? 0 : Math.min(amount, available);
    this.payAmount.set(amount > 0 ? String(amount) : '');
    this.payRows.set([{ key: salaryId, amount: portion > 0 ? String(round2(portion)) : '' }]);
    this.payError.set('');
    this.paying.set({ cycle, item });
  }

  confirmPaid(): void {
    const pay = this.paying();
    if (!pay) return;
    const amount = parseMoney(this.payAmount());
    if (amount <= 0) {
      this.payError.set('Enter the amount you paid.');
      return;
    }
    const shares = this.payRows()
      .map((row) => ({
        method: (row.key === 'cash' ? 'CASH' : 'BANK') as 'CASH' | 'BANK',
        accountId: row.key === 'cash' ? undefined : row.key,
        amount: parseMoney(row.amount),
      }))
      .filter((share) => share.amount > 0);
    if (!shares.length) {
      this.payError.set('Enter a portion for at least one source.');
      return;
    }
    if (Math.abs(round2(shares.reduce((sum, share) => sum + share.amount, 0)) - amount) > 0.001) {
      this.payError.set('Portions must add up to the amount paid. Add another source for the rest, or lower a portion.');
      return;
    }
    const keys = shares.map((share) => share.accountId ?? 'cash');
    if (new Set(keys).size !== keys.length) {
      this.payError.set('Use each source only once.');
      return;
    }
    for (const share of shares) {
      const available = this.sourceBalance(share.accountId ?? 'cash');
      if (available <= 0) {
        this.payError.set('A source has ₱0.00. Pick another source or add a row.');
        return;
      }
      if (share.amount > available + 0.001) {
        this.payError.set('A portion is more than that source’s balance. Lower it and add another source.');
        return;
      }
    }
    const done = this.budget.markAllocationPaid(pay.cycle.id, pay.item.id, {
      method: shares[0].method,
      accountId: shares[0].accountId,
      amount,
      shares,
    });
    if (!done) {
      this.payError.set('Choose where the money came from.');
      return;
    }
    this.paying.set(null);
  }
}

interface PayRow {
  key: string;
  amount: string;
}
