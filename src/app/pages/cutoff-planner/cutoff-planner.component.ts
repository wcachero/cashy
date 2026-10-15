import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { LucideCheck, LucidePiggyBank } from '@lucide/angular';
import { CATEGORY_META, cutoffLabel } from '../../core/categories';
import { formatShortDate } from '../../core/dates';
import { parseMoney } from '../../core/money';
import { PaycheckCycle } from '../../models/budget.model';
import { BudgetStateService, CutoffIncomeLine } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';

@Component({
  selector: 'app-cutoff-planner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, PhpPipe, LucideCheck, LucidePiggyBank],
  template: `
    <section>
      <p class="text-sm text-slate-400">Sinking fund carry-over</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Paycheck cutoffs</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Check a bill when you pay it. The balance and remaining terms update immediately, and any cash you hold back lands on the next cutoff.
      </p>
    </section>

    <div class="mt-5 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Paycheck cycles">
      @for (cycle of budget.paycheckCycles(); track cycle.id) {
        <button
          type="button"
          role="tab"
          class="shrink-0 rounded-full border px-3 py-2 text-left text-sm transition"
          [ngClass]="selected().id === cycle.id ? 'border-emerald-300 bg-emerald-400 text-slate-950' : 'border-white/10 bg-white/5'"
          [attr.aria-selected]="selected().id === cycle.id"
          (click)="selectedId.set(cycle.id)"
        >
          <span class="block font-semibold">{{ shortDate(cycle.cutoffDate) }}</span>
          <span class="block text-[11px] opacity-70">{{ paidCount(cycle) }}/{{ cycle.allocations.length }} paid</span>
        </button>
      }
    </div>

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
          <p class="font-mono text-lg" [class.text-rose-300]="isNegative(budget.cycleUnallocated(cycle))" [class.text-emerald-300]="!isNegative(budget.cycleUnallocated(cycle))">
            {{ budget.cycleUnallocated(cycle) | php }} left
          </p>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          @for (line of budget.cutoffIncomeLines(cycle); track line.id) {
            <div class="rounded-2xl px-3 py-2" [ngClass]="line.kind === 'carry' ? 'bg-violet-400/10' : line.kind === 'owe' ? 'bg-sky-400/10' : 'bg-white/5'">
              <p class="text-[11px] uppercase tracking-[0.14em] text-slate-400">{{ incomeKind(line.kind) }}</p>
              <p class="mt-1 text-sm font-semibold">{{ line.name }}</p>
              <p class="font-mono text-sm">{{ line.amount | php }}</p>
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
                (click)="budget.toggleAllocationPaid(cycle.id, item.id)"
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
                  @if (item.isPaid) {
                    <span class="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">Paid</span>
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
  `,
})
export class CutoffPlannerComponent {
  readonly budget = inject(BudgetStateService);
  readonly selectedId = signal<string | null>(null);
  readonly shortDate = formatShortDate;
  readonly categoryMeta = CATEGORY_META;
  readonly cutoffLabel = cutoffLabel;

  readonly selected = computed(() => {
    const cycles = this.budget.paycheckCycles();
    const chosen = this.selectedId();
    return cycles.find((cycle) => cycle.id === chosen) ?? this.budget.upcomingCycle() ?? cycles[0];
  });

  readonly nextCycle = computed(() => {
    const cycles = this.budget.paycheckCycles();
    const current = this.selected();
    const index = cycles.findIndex((cycle) => cycle.id === current?.id);
    return index >= 0 ? cycles[index + 1] : undefined;
  });

  constructor() {
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
}
