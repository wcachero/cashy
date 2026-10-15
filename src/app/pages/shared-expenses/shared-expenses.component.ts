import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucidePlus, LucideTrash2, LucideUsers } from '@lucide/angular';
import { formatLongDate, todayIso } from '../../core/dates';
import { parseMoney, round2 } from '../../core/money';
import { SharedExpense, SharedExpenseShare } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

@Component({
  selector: 'app-shared-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, WarningPopupComponent, LucideUsers, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Bills split with other people</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Shared expenses</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Add a bill and the people who split it with you. Each person is added to Owes you. Checking paid records the date and adds their share to the cutoff on or after that date.
      </p>
    </section>

    <form class="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="addExpense($event)">
      <label class="text-xs text-slate-400 sm:col-span-2">
        Expense name
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Meralco" [value]="expenseName()" (input)="expenseName.set(text($event))" />
      </label>
      <label class="text-xs text-slate-400">
        Date
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="expenseDate()" (input)="expenseDate.set(text($event))" />
      </label>
      <label class="text-xs text-slate-400">
        Total
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" placeholder="10000" [value]="expenseTotal()" (input)="expenseTotal.set(text($event))" />
      </label>
      <div class="sm:col-span-2 lg:col-span-4">
        <button type="submit" class="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Add shared expense
        </button>
      </div>
    </form>

    @if (budget.sharedExpenses().length === 0) {
      <p class="mt-4 flex items-center gap-2 text-sm text-slate-500">
        <svg lucideUsers [size]="16"></svg> No shared expenses yet.
      </p>
    } @else {
      <ul class="mt-4 space-y-4">
        @for (expense of budget.sharedExpenses(); track expense.id) {
          <li class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold">{{ expense.name }}</h2>
                <p class="mt-1 text-sm text-slate-400">{{ expense.expenseDate ? paidLabel(expense.expenseDate) : 'No date yet' }} · {{ expense.shares.length }} {{ expense.shares.length === 1 ? 'person' : 'people' }} splitting this bill</p>
              </div>
              <p class="font-mono text-lg">{{ expense.totalAmount | php }}</p>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt class="text-xs text-slate-500">Date</dt>
                <dd>
                  <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="expense.expenseDate || ''" (change)="changeExpenseDate(expense.id, $event)" />
                </dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Split so far</dt>
                <dd class="font-mono">{{ splitTotal(expense) | php }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Your share</dt>
                <dd class="font-mono">{{ yours(expense) | php }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Still unpaid</dt>
                <dd class="font-mono text-sky-200">{{ unpaid(expense) | php }}</dd>
              </div>
            </dl>

            @if (expense.shares.length > 0) {
              <ul class="mt-4 space-y-2">
                @for (share of expense.shares; track share.id) {
                  <li class="rounded-2xl border border-white/15 bg-slate-950 px-3 py-3">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p class="font-semibold">{{ share.name }}</p>
                        <p class="font-mono text-sm text-slate-300">{{ share.amount | php }}</p>
                        @if (share.paid && share.paidOn) {
                          <p class="mt-1 text-xs text-emerald-200">Paid {{ paidLabel(share.paidOn) }}</p>
                        }
                      </div>
                      <div class="flex flex-wrap items-center gap-3">
                        <label class="flex items-center gap-2 text-sm">
                          <input type="checkbox" [checked]="share.paid" (change)="togglePaid(expense.id, share, $event)" />
                          Paid
                        </label>
                        <label class="text-xs text-slate-400">
                          Paid date
                          <input class="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="share.paidOn || today" (change)="changeDate(expense.id, share, $event)" />
                        </label>
                        <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="budget.removeShare(expense.id, share.id)">
                          <svg lucideTrash2 [size]="14"></svg> Remove
                        </button>
                      </div>
                    </div>
                  </li>
                }
              </ul>
            }

            <form class="mt-4 grid gap-3 sm:grid-cols-3" (submit)="addPerson($event, expense)">
              <label class="text-xs text-slate-400">
                Name
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Who shares this" name="person" />
              </label>
              <label class="text-xs text-slate-400">
                Their share
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" name="amount" />
              </label>
              <div class="flex items-end">
                <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-semibold">
                  <svg lucidePlus [size]="14"></svg> Add person
                </button>
              </div>
            </form>
            <button type="button" class="mt-4 inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/30 px-3 py-2 text-sm text-rose-200" (click)="pendingDelete.set(expense)">
              <svg lucideTrash2 [size]="14"></svg> Remove expense
            </button>
          </li>
        }
      </ul>
    }

    @if (pendingDelete(); as expense) {
      <div class="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 px-4" (click)="pendingDelete.set(null)">
        <div class="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5" (click)="$event.stopPropagation()">
          <h2 class="text-xl font-bold">Remove {{ expense.name }}?</h2>
          <p class="mt-2 text-sm text-slate-400">The people on this bill are removed from Owes you. A paid share is taken off the cutoff it was added to.</p>
          <div class="mt-5 flex gap-2">
            <button type="button" class="rounded-2xl bg-rose-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="confirmDelete()">Remove</button>
            <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="pendingDelete.set(null)">Cancel</button>
          </div>
        </div>
      </div>
    }

    <app-warning [message]="error()" (closed)="error.set('')" />
  `,
})
export class SharedExpensesComponent {
  readonly budget = inject(BudgetStateService);
  readonly expenseName = signal('');
  readonly expenseDate = signal(todayIso());
  readonly expenseTotal = signal('');
  readonly error = signal('');
  readonly pendingDelete = signal<SharedExpense | null>(null);
  readonly today = todayIso();

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  splitTotal(expense: SharedExpense): number {
    return round2(expense.shares.reduce((sum, share) => sum + share.amount, 0));
  }

  yours(expense: SharedExpense): number {
    return round2(Math.max(0, expense.totalAmount - this.splitTotal(expense)));
  }

  unpaid(expense: SharedExpense): number {
    return round2(expense.shares.filter((share) => !share.paid).reduce((sum, share) => sum + share.amount, 0));
  }

  paidLabel(iso: string): string {
    return formatLongDate(iso);
  }

  addExpense(event: Event): void {
    event.preventDefault();
    const name = this.expenseName().trim();
    const total = parseMoney(this.expenseTotal());
    const date = this.expenseDate().trim();
    if (!name) {
      this.error.set('Enter the expense name.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.error.set('Enter the expense date.');
      return;
    }
    if (total <= 0) {
      this.error.set('Enter a total greater than zero.');
      return;
    }
    this.budget.addSharedExpense(name, total, date);
    this.expenseName.set('');
    this.expenseDate.set(todayIso());
    this.expenseTotal.set('');
    this.error.set('');
  }

  changeExpenseDate(id: string, event: Event): void {
    const date = (event.target as HTMLInputElement).value;
    if (!date) {
      this.error.set('Enter the expense date.');
      return;
    }
    this.budget.setSharedExpenseDate(id, date);
    this.error.set('');
  }

  addPerson(event: Event, expense: SharedExpense): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('person') ?? '').trim();
    const amount = parseMoney(String(data.get('amount') ?? ''));
    if (!name) {
      this.error.set('Enter the person\'s name.');
      return;
    }
    if (amount <= 0) {
      this.error.set('Enter that person\'s share.');
      return;
    }
    const room = round2(expense.totalAmount - this.splitTotal(expense));
    if (amount > room + 0.001) {
      this.error.set('Those shares are more than the expense total.');
      return;
    }
    if (!this.budget.addShare(expense.id, name, amount)) {
      this.error.set('Those shares are more than the expense total.');
      return;
    }
    form.reset();
    this.error.set('');
  }

  togglePaid(expenseId: string, share: SharedExpenseShare, event: Event): void {
    const paid = (event.target as HTMLInputElement).checked;
    const dateInput = (event.target as HTMLInputElement).closest('li')?.querySelector<HTMLInputElement>('input[type="date"]');
    this.budget.setSharePaid(expenseId, share.id, paid, dateInput?.value || this.today);
  }

  changeDate(expenseId: string, share: SharedExpenseShare, event: Event): void {
    const date = (event.target as HTMLInputElement).value;
    if (!share.paid || !date) return;
    this.budget.setSharePaid(expenseId, share.id, true, date);
  }

  confirmDelete(): void {
    const expense = this.pendingDelete();
    if (!expense) return;
    this.budget.removeSharedExpense(expense.id);
    this.pendingDelete.set(null);
  }
}
