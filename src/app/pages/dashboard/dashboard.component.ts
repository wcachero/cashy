import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowUpRight, LucideCircleAlert, LucideSparkles, LucideTarget, LucideTriangleAlert } from '@lucide/angular';
import { CATEGORY_META } from '../../core/categories';
import { duePhrase, formatLongDate, formatShortDate, formatWeekday, today, todayIso } from '../../core/dates';
import { collectYears, dateInPeriod, rangeOverlapsPeriod } from '../../core/period';
import { round2 } from '../../core/money';
import { DebtSlice, FreeCashStep, LiabilityCategory, UpcomingDue } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { PeriodFilterComponent } from '../../shared/period-filter.component';
import { PhpPipe } from '../../shared/php.pipe';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, PeriodFilterComponent, LucideTriangleAlert, LucideTarget, LucideSparkles, LucideArrowUpRight, LucideCircleAlert],
  template: `
    <section class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm text-slate-400">{{ todayLabel }}</p>
        <h1 class="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Dashboard</h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-400">{{ budget.planSummary() }}</p>
        <app-period-filter class="mt-4 block" [(month)]="month" [(year)]="year" [years]="years()" />
      </div>
      @if (budget.upcomingCycle(); as cycle) {
        <a routerLink="/cutoffs" [queryParams]="{ cycle: cycle.id }" class="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm transition hover:bg-emerald-400/15">
          <span class="block text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/80">Next paycheck</span>
          <span class="mt-1 block font-semibold">{{ shortDate(cycle.cutoffDate) }}</span>
          <span class="font-mono text-emerald-200">{{ budget.cycleInflow(cycle) | php }} available</span>
        </a>
      }
    </section>

    @if (planIsEmpty()) {
      <section class="mt-6 rounded-3xl border border-sky-400/30 bg-sky-400/10 p-5">
        <h2 class="text-lg font-bold">Import your plan</h2>
        <p class="mt-2 max-w-2xl text-sm text-sky-100/90">
          This account starts empty. In Settings, import <span class="font-mono">financial-plan-2026-10-15.json</span> to load your income, debts, expenses, and cutoffs.
        </p>
        <a routerLink="/settings" class="mt-4 inline-flex rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950">Open Settings</a>
      </section>
    }

    @if (!periodOn()) {
      @if (budget.upcomingDues().length) {
      <section class="mt-6 space-y-3" aria-label="Bills due within 7 days">
        @for (due of budget.upcomingDues(); track due.liabilityId + due.dueDate) {
          <article class="flex flex-col gap-4 rounded-3xl border border-amber-300/30 bg-amber-300/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex gap-3">
              <span class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-300 text-slate-950">
                <svg lucideTriangleAlert [size]="18"></svg>
              </span>
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100/80">{{ duePhrase(due.daysUntil) }}</p>
                <h2 class="text-lg font-bold">{{ due.name }}</h2>
                <p class="mt-1 text-sm text-amber-50/80">
                  @if (showsMinimum(due)) {
                    Pay the {{ due.minimumDue | php }} minimum on {{ longDate(due.dueDate) }}, or {{ due.fullBalance | php }} to clear it.
                  } @else if (minimumLogged(due)) {
                    Minimum is logged. {{ due.fullBalance | php }} remains and is already planned on the next cutoff.
                  } @else if (due.fullBalance > 0 && due.category !== 'LIVING_EXPENSE') {
                    {{ due.suggestedAmount | php }} is lined up for {{ longDate(due.dueDate) }}.
                  } @else {
                    {{ due.suggestedAmount | php }} is due {{ longDate(due.dueDate) }}.
                  }
                </p>
              </div>
            </div>
            @if (showsMinimum(due)) {
              <button type="button" class="rounded-2xl bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950" (click)="logMinimum(due)">
                Log {{ due.minimumDue | php }} minimum
              </button>
            }
          </article>
        }
        @if (notice()) {
          <p class="text-sm text-emerald-300">{{ notice() }}</p>
        }
      </section>
    } @else {
      <section class="mt-6 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
        <svg lucideCircleAlert [size]="18" class="text-emerald-300"></svg>
        Nothing is due in the next 7 days.
      </section>
    }
    } @else if (periodBills().length) {
      <section class="mt-6 space-y-3" aria-label="Bills in the selected period">
        @for (item of periodBills(); track item.id) {
          <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Due day {{ item.dueDayOfMonth }}</p>
            <h2 class="text-lg font-bold">{{ item.name }}</h2>
            <p class="mt-1 font-mono text-sm text-slate-300">{{ item.category === 'LIVING_EXPENSE' ? (item.monthlyAmortization | php) : (item.totalBalance | php) }}</p>
          </article>
        }
      </section>
    } @else {
      <section class="mt-6 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
        <svg lucideCircleAlert [size]="18" class="text-emerald-300"></svg>
        Nothing is due in this period.
      </section>
    }

    @if (pastDueList().length) {
      <section class="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Past due loans">
        @for (item of pastDueList(); track item.id) {
          <a routerLink="/debts" class="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">Past due</p>
            <p class="mt-1 font-semibold">{{ item.name }}</p>
            <p class="font-mono text-sm text-rose-100">{{ item.totalBalance | php }} · settle {{ item.endDate ? longDate(item.endDate) : 'soon' }}</p>
          </a>
        }
      </section>
    }

    <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Total debt remaining</p>
        <p class="mt-3 font-mono text-2xl font-semibold text-rose-200">{{ debtRemaining() | php }}</p>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-emerald-400" [style.width.%]="paidPercent()"></div>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ paidPercent().toFixed(1) }}% of {{ debtOriginal() | php }} paid off</p>
      </article>

      @if (girlieVisible(); as person) {
        <article class="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4">
          <p class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100/80">
            <svg lucideTarget [size]="14"></svg> {{ person.name }}
          </p>
          <p class="mt-3 font-mono text-2xl font-semibold">{{ person.totalBalance | php }}</p>
          <p class="text-xs text-emerald-100/70">left of {{ (person.originalBalance ?? person.totalBalance) | php }}</p>
          <div class="mt-4 h-2 overflow-hidden rounded-full bg-emerald-950/50">
            <div class="h-full rounded-full bg-emerald-300" [style.width.%]="budget.girliePercent()"></div>
          </div>
          <p class="mt-2 text-xs text-emerald-100/80">
            {{ budget.girliePaid() | php }} paid
            @if (person.endDate) { · target {{ longDate(person.endDate) }} }
            @if (clearDate(); as date) { · clears {{ longDate(date) }} }
          </p>
        </article>
      }

      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Monthly free cash</p>
        <p class="mt-3 font-mono text-2xl font-semibold text-sky-200">{{ budget.monthlyFreeCashFlow() | php }}</p>
        <p class="mt-2 text-xs text-slate-400">
          After living costs and fixed loans.
          @if (laterCash(); as step) { Rises to {{ step.amount | php }} by {{ step.label }}. }
        </p>
      </article>

      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">This cutoff leftover</p>
        @if (budget.upcomingCycle(); as cycle) {
          <p class="mt-3 font-mono text-2xl font-semibold" [class.text-rose-300]="isNegative(budget.cycleUnallocated(cycle))" [class.text-emerald-200]="!isNegative(budget.cycleUnallocated(cycle))">
            {{ budget.cycleUnallocated(cycle) | php }}
          </p>
          <p class="mt-2 text-xs text-slate-400">{{ cycle.label }}</p>
        }
      </article>
    </section>

    <section class="mt-6 grid gap-4 lg:grid-cols-5">
      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-5 lg:col-span-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-bold">Where the debt sits</h2>
          <a routerLink="/debts" class="inline-flex items-center gap-1 text-sm text-emerald-300">Inventory <svg lucideArrowUpRight [size]="14"></svg></a>
        </div>
        <div class="mt-4 flex h-3 overflow-hidden rounded-full bg-white/5">
          @for (slice of periodMix(); track slice.category) {
            <div class="h-full first:rounded-l-full last:rounded-r-full" [class]="slice.barClass" [style.width.%]="slice.percent"></div>
          }
        </div>
        <ul class="mt-4 grid gap-2 sm:grid-cols-2">
          @for (slice of periodMix(); track slice.category) {
            <li class="flex items-center justify-between gap-3 text-sm">
              <span class="flex items-center gap-2 text-slate-300">
                <span class="h-2.5 w-2.5 rounded-full" [class]="slice.barClass"></span>
                {{ slice.label }}
              </span>
              <span class="font-mono">{{ slice.amount | php }}</span>
            </li>
          }
        </ul>
      </article>

      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-5 lg:col-span-2">
        <h2 class="flex items-center gap-2 text-lg font-bold"><svg lucideSparkles [size]="18" class="text-sky-300"></svg> Cash that unlocks</h2>
        <ul class="mt-4 space-y-4">
          @for (step of shownSteps(); track step.label) {
            <li>
              <div class="flex items-baseline justify-between gap-3">
                <span>
                  <span class="block text-sm font-semibold">{{ step.label }}</span>
                  <span class="text-xs text-slate-400">{{ step.detail }}</span>
                </span>
                <span class="font-mono text-sm">{{ step.amount | php }}</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div class="h-full rounded-full bg-sky-300" [style.width.%]="barWidth(step.amount)"></div>
              </div>
            </li>
          }
        </ul>
      </article>
    </section>

    <section class="mt-6">
      <h2 class="text-lg font-bold">Milestone timeline</h2>
      @if (shownMilestones().length === 0) {
        <p class="mt-3 text-sm text-slate-400">Payoff dates appear here after your plan is imported.</p>
      } @else {
      <ol class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        @for (milestone of shownMilestones(); track milestone.id; let index = $index) {
          <li class="rounded-3xl border p-4" [class]="milestone.done ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-slate-900/70'">
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{{ index + 1 }} · {{ shortDate(milestone.date) }}</p>
            <h3 class="mt-2 font-bold">{{ milestone.title }}</h3>
            <p class="mt-2 text-sm text-slate-400">{{ milestone.detail }}</p>
            <p class="mt-3 text-xs font-semibold" [class.text-emerald-300]="milestone.done" [class.text-slate-500]="!milestone.done">
              {{ milestone.done ? 'Done' : 'Ahead' }}
            </p>
          </li>
        }
      </ol>
      }
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">Upcoming cutoffs</h2>
        <a routerLink="/cutoffs" class="text-sm text-emerald-300">Open planner</a>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        @for (cycle of shownCycles(); track cycle.id) {
          <a routerLink="/cutoffs" [queryParams]="{ cycle: cycle.id }" class="rounded-3xl border border-white/10 bg-slate-900/70 p-4 transition hover:border-emerald-400/40">
            <p class="text-sm font-semibold">{{ shortDate(cycle.cutoffDate) }}</p>
            <p class="mt-2 font-mono text-lg">{{ budget.cycleInflow(cycle) | php }}</p>
            <p class="mt-1 text-xs text-slate-400">{{ cycle.allocations.length }} bills · {{ budget.cycleUnallocated(cycle) | php }} left</p>
            @if (cycle.sinkingFundReserved > 0) {
              <p class="mt-2 text-xs text-violet-200">Reserve {{ cycle.sinkingFundReserved | php }} for the next cutoff</p>
            }
          </a>
        }
      </div>
    </section>

  `,
})
export class DashboardComponent {
  readonly budget = inject(BudgetStateService);
  readonly todayLabel = formatWeekday(today());
  readonly shortDate = formatShortDate;
  readonly longDate = formatLongDate;
  readonly duePhrase = duePhrase;
  readonly notice = signal('');
  readonly month = signal('all');
  readonly year = signal('all');
  private readonly debtCategories: LiabilityCategory[] = ['REVOLVING_CC', 'ONE_TIME_OLA', 'PAST_DUE_OLA', 'FIXED_LOAN', 'PERSONAL_DEBT'];

  readonly years = computed(() =>
    collectYears(
      [
        ...this.budget.paycheckCycles().map((cycle) => cycle.cutoffDate),
        ...this.budget.milestones().map((item) => item.date),
        ...this.budget.receivables().map((item) => item.borrowedOn),
      ],
      this.budget.liabilities().map((item) => ({ start: item.startDate, end: item.endDate })),
    ),
  );

  readonly periodOn = computed(() => this.month() !== 'all' || this.year() !== 'all');

  readonly periodLiabilities = computed(() =>
    this.budget.liabilities().filter((item) => rangeOverlapsPeriod(item.startDate, item.endDate, this.month(), this.year())),
  );

  readonly periodBills = computed(() => this.periodLiabilities().filter((item) => item.status !== 'PAID'));

  readonly pastDueList = computed(() =>
    this.budget.pastDueLiabilities().filter((item) => rangeOverlapsPeriod(item.startDate, item.endDate, this.month(), this.year())),
  );

  readonly debtRemaining = computed(() =>
    round2(
      this.periodLiabilities()
        .filter((item) => item.category !== 'LIVING_EXPENSE' && item.status !== 'PAID')
        .reduce((sum, item) => sum + Math.max(0, item.totalBalance), 0),
    ),
  );

  readonly debtOriginal = computed(() =>
    round2(
      this.periodLiabilities()
        .filter((item) => item.category !== 'LIVING_EXPENSE')
        .reduce((sum, item) => sum + Math.max(item.originalBalance ?? item.totalBalance, item.totalBalance, 0), 0),
    ),
  );

  readonly paidPercent = computed(() => {
    const original = this.debtOriginal();
    if (original <= 0) return 0;
    return Math.min(100, Math.max(0, ((original - this.debtRemaining()) / original) * 100));
  });

  readonly girlieVisible = computed(() => {
    const person = this.budget.girlie();
    if (!person || !rangeOverlapsPeriod(person.startDate, person.endDate, this.month(), this.year())) return null;
    return person;
  });

  readonly periodMix = computed<DebtSlice[]>(() => {
    const items = this.periodLiabilities().filter((item) => item.category !== 'LIVING_EXPENSE' && item.status !== 'PAID');
    const total = items.reduce((sum, item) => sum + Math.max(0, item.totalBalance), 0);
    return this.debtCategories
      .map((category) => {
        const amount = round2(items.filter((item) => item.category === category).reduce((sum, item) => sum + item.totalBalance, 0));
        return {
          category,
          label: CATEGORY_META[category].label,
          amount,
          percent: total > 0 ? (amount / total) * 100 : 0,
          barClass: CATEGORY_META[category].barClass,
        };
      })
      .filter((slice) => slice.amount > 0);
  });

  readonly shownSteps = computed(() =>
    this.budget.freeCashSteps().filter((step) => {
      if (step.label === 'Now') return dateInPeriod(todayIso(), this.month(), this.year());
      const parsed = new Date(step.label.replace(/^(\w+) (\d+)$/, '$1 1, $2'));
      if (Number.isNaN(parsed.getTime())) return !this.periodOn();
      const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-01`;
      return dateInPeriod(iso, this.month(), this.year());
    }),
  );

  readonly shownMilestones = computed(() =>
    this.budget.milestones().filter((item) => dateInPeriod(item.date, this.month(), this.year())),
  );

  readonly shownCycles = computed(() => {
    if (!this.periodOn()) return this.nextCycles();
    return this.budget.paycheckCycles().filter((cycle) => dateInPeriod(cycle.cutoffDate, this.month(), this.year()));
  });

  planIsEmpty(): boolean {
    return this.budget.liabilities().length === 0 && this.budget.paycheckCycles().length === 0;
  }

  nextCycles() {
    const cycles = this.budget.paycheckCycles();
    const upcoming = this.budget.upcomingCycle();
    const start = upcoming ? cycles.findIndex((cycle) => cycle.id === upcoming.id) : 0;
    return cycles.slice(Math.max(0, start), Math.max(0, start) + 4);
  }

  laterCash(): FreeCashStep | null {
    const steps = this.shownSteps();
    return steps.length > 1 ? (steps.at(-1) ?? null) : null;
  }

  clearDate(): string | null {
    const projected = this.budget.girliePayoffDate();
    const target = this.budget.girlie()?.endDate;
    if (!projected || projected === 'Paid off' || projected === target) return null;
    return projected;
  }

  barWidth(amount: number): number {
    const peak = Math.max(...this.shownSteps().map((step) => step.amount), 1);
    return Math.max(4, (amount / peak) * 100);
  }

  isNegative(amount: number): boolean {
    return amount < 0;
  }

  showsMinimum(due: UpcomingDue): boolean {
    return !!due.minimumDue && due.minimumDue < due.fullBalance && !this.minimumLogged(due);
  }

  minimumLogged(due: UpcomingDue): boolean {
    const item = this.budget.liabilities().find((entry) => entry.id === due.liabilityId);
    if (!item?.minimumDue || item.originalBalance == null) return false;
    return item.totalBalance <= item.originalBalance - item.minimumDue + 0.05;
  }

  logMinimum(due: UpcomingDue): void {
    if (!due.minimumDue) return;
    this.budget.logAdHocPayment(due.liabilityId, due.minimumDue, 'Minimum due');
    this.notice.set(`${due.name} minimum logged for ${formatLongDate(due.dueDate)}.`);
  }
}
