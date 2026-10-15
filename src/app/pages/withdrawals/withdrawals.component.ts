import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { LucideArrowDownToLine, LucideChevronLeft, LucideChevronRight, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { formatShortDate, todayIso } from '../../core/dates';
import { parseMoney, round2 } from '../../core/money';
import { collectYears, dateInPeriod } from '../../core/period';
import { BudgetStateService } from '../../services/budget-state.service';
import { PeriodFilterComponent } from '../../shared/period-filter.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

const PAGE_SIZE = 10;

interface Source {
  key: string;
  kind: 'cutoff' | 'savings';
  id: string;
  label: string;
  available: number;
}

@Component({
  selector: 'app-withdrawals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, WarningPopupComponent, PeriodFilterComponent, LucideArrowDownToLine, LucidePlus, LucideTrash2, LucideChevronLeft, LucideChevronRight],
  template: `
    <section>
      <p class="text-sm text-slate-400">Cash taken out</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Withdrawals</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Take cash from a cutoff that has already arrived or from a bank or e-wallet balance at any time. The cash lands in cash on hand, and the balance it came from goes down.
      </p>
    </section>

    <section class="mt-6 grid gap-3 sm:grid-cols-3">
      <article class="rounded-3xl border border-sky-400/30 bg-sky-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">Cutoff cash</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ totalRemaining() | php }}</p>
        <p class="mt-2 text-sm text-sky-100/80">Cutoffs up to today, after bills paid and withdrawals.</p>
      </article>
      <article class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Banks & e-wallets</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.otherBankSavings() | php }}</p>
        <p class="mt-2 text-sm text-emerald-100/80">{{ budget.bankSavings().length }} {{ budget.bankSavings().length === 1 ? 'balance' : 'balances' }} you can withdraw from.</p>
      </article>
      <article class="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">Cash on hand</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.cashOnHand() | php }}</p>
        <p class="mt-2 text-sm text-amber-50/80">Every withdrawal adds to this.</p>
      </article>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucideArrowDownToLine [size]="18" class="text-sky-300"></svg>
        <h2 class="text-lg font-bold">Withdraw cash</h2>
      </div>
      @if (sources().length === 0) {
        <p class="mt-3 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
          No cutoff has arrived yet and no bank or e-wallet balance is recorded. Record a balance on the Savings page to withdraw from it.
        </p>
      } @else {
        <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="add($event)">
          <label class="text-xs text-slate-400 sm:col-span-2">
            From
            <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="sourceKey.set(choice($event))">
              @if (cutoffSources().length) {
                <optgroup label="Cutoffs">
                  @for (row of cutoffSources(); track row.key) {
                    <option [value]="row.key" [selected]="row.key === chosenKey()">{{ row.label }} · {{ row.available | php }} left</option>
                  }
                </optgroup>
              }
              @if (savingsSources().length) {
                <optgroup label="Banks & e-wallets">
                  @for (row of savingsSources(); track row.key) {
                    <option [value]="row.key" [selected]="row.key === chosenKey()">{{ row.label }} · {{ row.available | php }}</option>
                  }
                </optgroup>
              }
            </select>
          </label>
          <label class="text-xs text-slate-400">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="amount()" (input)="amount.set(text($event))" />
          </label>
          @if (chosen()?.kind === 'savings') {
            <label class="text-xs text-slate-400">
              Date
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="date()" (input)="date.set(text($event))" />
            </label>
          }
          <label class="text-xs text-slate-400" [class.lg:col-span-3]="chosen()?.kind !== 'savings'" [class.sm:col-span-2]="chosen()?.kind !== 'savings'">
            Note
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Optional" [value]="note()" (input)="note.set(text($event))" />
          </label>
          <div class="flex items-end" [class.sm:col-span-2]="chosen()?.kind === 'savings'" [class.lg:col-span-4]="chosen()?.kind === 'savings'">
            <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-300 px-4 py-2.5 text-sm font-bold text-slate-950 sm:w-auto">
              <svg lucidePlus [size]="16"></svg> Withdraw
            </button>
          </div>
          @if (chosen(); as row) {
            <p class="text-sm text-slate-300 sm:col-span-2 lg:col-span-4">
              @if (row.kind === 'savings') {
                {{ row.label }} has {{ row.available | php }}. Withdrawing lowers that balance and adds to cash on hand.
              } @else {
                {{ row.label }} has {{ row.available | php }} remaining after bills paid and withdrawals. The cash is added to cash on hand.
              }
            </p>
          }
          <app-warning [message]="error()" (closed)="error.set('')" />
        </form>
      }
    </section>

    <section class="mt-8">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold">Withdrawal history</h2>
          <p class="mt-1 text-sm text-slate-400">{{ filtered().length }} {{ filtered().length === 1 ? 'withdrawal' : 'withdrawals' }} · {{ filteredTotal() | php }}</p>
        </div>
        <app-period-filter [(month)]="month" [(year)]="year" [years]="years()" />
      </div>
      @if (filtered().length === 0) {
        <p class="mt-3 text-sm text-slate-500">{{ budget.withdrawals().length === 0 ? 'No cash has been withdrawn.' : 'No withdrawals in this period.' }}</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (entry of pageItems(); track entry.id) {
            <li class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
              <div class="min-w-0">
                <p class="font-semibold">{{ shortDate(entry.withdrawnOn) }}</p>
                <p class="truncate text-xs text-slate-400">
                  <span [class]="entry.kind === 'savings' ? 'text-emerald-200' : 'text-sky-200'">{{ entry.source }}</span>
                  @if (entry.note) { · {{ entry.note }} }
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <p class="font-mono text-rose-200">{{ entry.amount | php }}</p>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="budget.removeWithdrawal(entry.id)">
                  <svg lucideTrash2 [size]="14"></svg> Remove
                </button>
              </div>
            </li>
          }
        </ul>
        @if (pageCount() > 1) {
          <nav class="mt-4 flex items-center justify-between gap-3" aria-label="Withdrawal pages">
            <button type="button" class="inline-flex items-center gap-1 rounded-2xl border border-white/15 px-3 py-2 text-sm disabled:opacity-40" [disabled]="page() <= 1" (click)="page.set(page() - 1)">
              <svg lucideChevronLeft [size]="14"></svg> Newer
            </button>
            <p class="text-sm text-slate-400">Page {{ page() }} of {{ pageCount() }}</p>
            <button type="button" class="inline-flex items-center gap-1 rounded-2xl border border-white/15 px-3 py-2 text-sm disabled:opacity-40" [disabled]="page() >= pageCount()" (click)="page.set(page() + 1)">
              Older <svg lucideChevronRight [size]="14"></svg>
            </button>
          </nav>
        }
      }
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-bold">Cutoff balances</h2>
      @if (rows().length === 0) {
        <p class="mt-3 text-sm text-slate-500">Balances appear after a cutoff date.</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (row of rows(); track row.id) {
            <li class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
              <div>
                <p class="font-semibold">{{ shortDate(row.date) }}</p>
                <p class="text-xs text-slate-400">{{ row.cashIn | php }} in · {{ row.paid | php }} paid · {{ row.withdrawn | php }} withdrawn</p>
              </div>
              <p class="font-mono text-sky-200">{{ row.remaining | php }}</p>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class WithdrawalsComponent {
  readonly budget = inject(BudgetStateService);
  readonly shortDate = formatShortDate;
  readonly sourceKey = signal('');
  readonly amount = signal('');
  readonly date = signal(todayIso());
  readonly note = signal('');
  readonly error = signal('');
  readonly month = signal('all');
  readonly year = signal('all');
  readonly page = signal(1);

  readonly rows = computed(() =>
    this.budget
      .paycheckCycles()
      .filter((cycle) => cycle.cutoffDate <= todayIso())
      .map((cycle) => ({
        id: cycle.id,
        date: cycle.cutoffDate,
        label: cycle.label,
        cashIn: this.budget.cycleInflow(cycle),
        paid: this.budget.cyclePaid(cycle),
        withdrawn: this.budget.withdrawnFor(cycle.id),
        remaining: this.budget.remainingCash(cycle),
      })),
  );

  readonly cutoffSources = computed<Source[]>(() =>
    this.rows().map((row) => ({ key: `cutoff:${row.id}`, kind: 'cutoff', id: row.id, label: `${formatShortDate(row.date)} cutoff`, available: row.remaining })),
  );

  readonly savingsSources = computed<Source[]>(() =>
    this.budget
      .bankSavings()
      .map((item) => ({ key: `savings:${item.id}`, kind: 'savings', id: item.id, label: `${item.bankName} · ${item.accountName}`, available: item.amount })),
  );

  readonly sources = computed(() => [...this.cutoffSources(), ...this.savingsSources()]);

  readonly chosen = computed<Source | null>(
    () => this.sources().find((row) => row.key === this.sourceKey()) ?? this.cutoffSources().at(-1) ?? this.savingsSources().at(0) ?? null,
  );

  readonly chosenKey = computed(() => this.chosen()?.key ?? '');

  readonly totalRemaining = computed(() => round2(this.rows().reduce((sum, row) => sum + row.remaining, 0)));

  readonly entries = computed(() =>
    this.budget
      .withdrawals()
      .map((item) => {
        const cycle = item.cycleId ? this.budget.paycheckCycles().find((row) => row.id === item.cycleId) : undefined;
        const saving = item.savingsId ? this.budget.bankSavings().find((row) => row.id === item.savingsId) : undefined;
        const kind: Source['kind'] = item.savingsId ? 'savings' : 'cutoff';
        const source =
          (saving && `${saving.bankName} · ${saving.accountName}`) ||
          (cycle && `${formatShortDate(cycle.cutoffDate)} cutoff`) ||
          item.sourceName ||
          (kind === 'savings' ? 'Removed savings account' : 'Cutoff');
        return { id: item.id, kind, source, withdrawnOn: item.withdrawnOn, amount: item.amount, note: item.note ?? '' };
      })
      .sort((a, b) => b.withdrawnOn.localeCompare(a.withdrawnOn) || b.id.localeCompare(a.id)),
  );

  readonly years = computed(() => collectYears(this.budget.withdrawals().map((item) => item.withdrawnOn)));

  readonly filtered = computed(() => this.entries().filter((entry) => dateInPeriod(entry.withdrawnOn, this.month(), this.year())));

  readonly filteredTotal = computed(() => round2(this.filtered().reduce((sum, entry) => sum + entry.amount, 0)));

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)));

  readonly pageItems = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });

  constructor() {
    effect(() => {
      this.month();
      this.year();
      this.page.set(1);
    });
    effect(() => {
      if (this.page() > this.pageCount()) this.page.set(this.pageCount());
    });
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  add(event: Event): void {
    event.preventDefault();
    const source = this.chosen();
    if (!source) {
      this.error.set('Choose where the cash comes from.');
      return;
    }
    const amount = parseMoney(this.amount());
    if (amount <= 0) {
      this.error.set('Enter the amount to withdraw.');
      return;
    }
    if (amount > source.available + 0.009) {
      this.error.set(source.kind === 'savings' ? 'That amount is more than the savings balance.' : 'That amount is more than the remaining cash.');
      return;
    }
    if (source.kind === 'savings') {
      this.budget.addSavingsWithdrawal({ savingsId: source.id, amount, note: this.note(), withdrawnOn: this.date() });
    } else {
      this.budget.addWithdrawal({ cycleId: source.id, amount, note: this.note() });
    }
    this.amount.set('');
    this.note.set('');
    this.date.set(todayIso());
    this.error.set('');
  }
}
