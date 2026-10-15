import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideArrowDownToLine, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { formatShortDate, todayIso } from '../../core/dates';
import { parseMoney, round2 } from '../../core/money';
import { BudgetStateService } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

@Component({
  selector: 'app-withdrawals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, WarningPopupComponent, LucideArrowDownToLine, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Cash taken out</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Withdrawals</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Record cash you take from a cutoff that has already arrived. The balance is money received minus bills you marked paid and withdrawals. Projected leftover is not included.
      </p>
    </section>

    <section class="mt-6">
      <article class="max-w-md rounded-3xl border border-sky-400/30 bg-sky-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">Remaining cash</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ totalRemaining() | php }}</p>
        <p class="mt-2 text-sm text-sky-100/80">Cutoffs up to today, after withdrawals.</p>
      </article>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucideArrowDownToLine [size]="18" class="text-sky-300"></svg>
        <h2 class="text-lg font-bold">Withdraw cash</h2>
      </div>
      @if (rows().length === 0) {
        <p class="mt-3 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">No cutoff has arrived yet.</p>
      } @else {
        <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="add($event)">
          <label class="text-xs text-slate-400">
            Cutoff
            <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="chosenId()" (change)="cycleId.set(choice($event))">
              @for (row of rows(); track row.id) {
                <option [value]="row.id">{{ shortDate(row.date) }} · {{ row.remaining | php }} left</option>
              }
            </select>
          </label>
          <label class="text-xs text-slate-400">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="amount()" (input)="amount.set(text($event))" />
          </label>
          <label class="text-xs text-slate-400">
            Note
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Optional" [value]="note()" (input)="note.set(text($event))" />
          </label>
          <div class="flex items-end">
            <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-300 px-4 py-2.5 text-sm font-bold text-slate-950">
              <svg lucidePlus [size]="16"></svg> Withdraw
            </button>
          </div>
          @if (chosen(); as row) {
            <p class="text-sm text-slate-300 sm:col-span-2 lg:col-span-4">
              {{ shortDate(row.date) }} has {{ row.cashIn | php }} in, {{ row.paid | php }} paid, and {{ row.withdrawn | php }} withdrawn.
              Remaining cash is {{ row.remaining | php }}.
            </p>
          }
          <app-warning [message]="error()" (closed)="error.set('')" />
        </form>
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
                <p class="text-xs text-slate-400">{{ row.label }}</p>
              </div>
              <p class="font-mono text-sky-200">{{ row.remaining | php }}</p>
            </li>
          }
        </ul>
      }
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-bold">Recorded withdrawals</h2>
      @if (entries().length === 0) {
        <p class="mt-3 text-sm text-slate-500">No cash has been withdrawn.</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (entry of entries(); track entry.id) {
            <li class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
              <div>
                <p class="font-semibold">{{ shortDate(entry.date) }}</p>
                <p class="text-xs text-slate-400">{{ entry.note || 'Withdrawn ' + shortDate(entry.withdrawnOn) }}</p>
              </div>
              <div class="flex items-center gap-3">
                <p class="font-mono text-rose-200">{{ entry.amount | php }}</p>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="budget.removeWithdrawal(entry.id)">
                  <svg lucideTrash2 [size]="14"></svg> Remove
                </button>
              </div>
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
  readonly cycleId = signal('');
  readonly amount = signal('');
  readonly note = signal('');
  readonly error = signal('');

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

  readonly chosen = computed(() => this.rows().find((row) => row.id === this.cycleId()) ?? this.rows().at(-1) ?? null);

  readonly chosenId = computed(() => this.chosen()?.id ?? '');

  readonly totalRemaining = computed(() => round2(this.rows().reduce((sum, row) => sum + row.remaining, 0)));

  readonly entries = computed(() =>
    this.budget
      .withdrawals()
      .map((item) => {
        const cycle = this.budget.paycheckCycles().find((row) => row.id === item.cycleId);
        return {
          id: item.id,
          date: cycle?.cutoffDate ?? item.withdrawnOn,
          withdrawnOn: item.withdrawnOn,
          amount: item.amount,
          note: item.note ?? '',
        };
      })
      .sort((a, b) => b.withdrawnOn.localeCompare(a.withdrawnOn) || b.date.localeCompare(a.date)),
  );

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  add(event: Event): void {
    event.preventDefault();
    const row = this.chosen();
    if (!row) {
      this.error.set('Choose a cutoff that has already arrived.');
      return;
    }
    const amount = parseMoney(this.amount());
    if (amount <= 0) {
      this.error.set('Enter the amount to withdraw.');
      return;
    }
    if (amount > row.remaining + 0.009) {
      this.error.set('That amount is more than the remaining cash.');
      return;
    }
    this.budget.addWithdrawal({ cycleId: row.id, amount, note: this.note() });
    this.amount.set('');
    this.note.set('');
    this.error.set('');
  }
}
