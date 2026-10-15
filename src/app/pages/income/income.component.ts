import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideHandCoins, LucidePlus, LucideWallet } from '@lucide/angular';
import { formatLongDate, ordinalDay } from '../../core/dates';
import { parseMoney } from '../../core/money';
import { CutoffType, IncomeStream, Receivable } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';

@Component({
  selector: 'app-income',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, LucideWallet, LucideHandCoins, LucidePlus],
  template: `
    <section>
      <p class="text-sm text-slate-400">What funds each cutoff</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Income</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Salary cutoffs, money people owe you, and other income. Amounts update cutoffs that have not happened yet.
      </p>
    </section>

    @if (isEmpty()) {
      <p class="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
        Nothing is saved yet. Add a salary cutoff, someone who owes you, or other income. You can also import a plan from Settings.
      </p>
    }

    <form class="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="add($event)">
      <label class="text-xs text-slate-400">
        Kind
        <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="kind()" (change)="kind.set(choice($event))">
          <option value="salary">Salary cutoff</option>
          <option value="owe">Owes you</option>
          <option value="other">Other income</option>
        </select>
      </label>
      <label class="text-xs text-slate-400">
        Name
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [placeholder]="kind() === 'owe' ? 'Who owes you' : 'Income name'" [value]="name()" (input)="name.set(text($event))" />
      </label>
      <label class="text-xs text-slate-400">
        {{ kind() === 'owe' ? 'Payment each term' : 'Amount' }}
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="amount()" (input)="amount.set(text($event))" />
      </label>
      @if (kind() === 'salary') {
        <label class="text-xs text-slate-400">
          Cutoff
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="payDay()" (change)="payDay.set(choice($event))">
            <option value="10">Every 10th</option>
            <option value="15">Every 15th</option>
            <option value="25">Every 25th</option>
            <option value="30">Every 30th</option>
          </select>
        </label>
      } @else if (kind() === 'owe') {
        <label class="text-xs text-slate-400">
          Total debt
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="totalDebt()" (input)="totalDebt.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Terms
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="1" step="1" [value]="terms()" (input)="terms.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Due day
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="1" max="31" step="1" placeholder="30" [value]="dueDay()" (input)="dueDay.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Date borrowed
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="borrowedOn()" (input)="borrowedOn.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400 sm:col-span-2">
          Remarks
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="remarks()" (input)="remarks.set(text($event))" />
        </label>
      } @else {
        <label class="text-xs text-slate-400">
          Date received
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="receivedOn()" (input)="receivedOn.set(text($event))" />
        </label>
      }
      <div class="flex items-end">
        <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Add income
        </button>
      </div>
      @if (error()) {
        <p class="text-sm text-rose-300 sm:col-span-2 lg:col-span-4">{{ error() }}</p>
      }
    </form>

    <section class="mt-6">
      <h2 class="text-lg font-bold">Salary cutoffs</h2>
      @if (budget.salaryIncome().length === 0) {
        <p class="mt-2 text-sm text-slate-500">No salary cutoff is saved.</p>
      } @else {
        <ul class="mt-3 space-y-3">
          @for (stream of budget.salaryIncome(); track stream.id) {
            <li class="grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1.4fr_.8fr_auto] sm:items-end">
              <div>
                <p class="font-semibold">{{ stream.name }}</p>
                <p class="text-xs text-slate-400">Every {{ ordinal(stream.dayOfMonth) }} of the month</p>
              </div>
              <label class="text-xs text-slate-400">
                Amount
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="stream.amount" (change)="updateAmount(stream, $event)" />
              </label>
              <p class="font-mono text-sm text-emerald-200 sm:pb-2">{{ stream.amount | php }}</p>
            </li>
          }
        </ul>
      }
    </section>

    <section class="mt-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold">Owes you</h2>
          <p class="mt-1 text-sm text-slate-400">A payment is added to the matching cutoff only after you log it as paid.</p>
        </div>
        <a routerLink="/owes-you" class="text-sm font-semibold text-sky-300">Manage who owes you</a>
      </div>
      @if (budget.receivables().length === 0) {
        <p class="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <svg lucideHandCoins [size]="16"></svg> Nobody is recorded yet.
        </p>
      } @else {
        <ul class="mt-3 space-y-3">
          @for (item of budget.receivables(); track item.id) {
            <li class="rounded-3xl border border-sky-400/20 bg-sky-400/10 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="font-semibold">{{ item.name }}</p>
                  <p class="mt-1 text-sm text-sky-100/80">{{ owePhrase(item) }}</p>
                  @if (item.borrowedOn) {
                    <p class="mt-1 text-xs text-sky-100/70">Borrowed {{ longDate(item.borrowedOn) }}</p>
                  }
                  @if (item.notes) {
                    <p class="mt-1 text-sm text-sky-50/80">{{ item.notes }}</p>
                  }
                </div>
                <p class="font-mono text-emerald-200">{{ item.paymentAmount | php }}</p>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    <section class="mt-6">
      <h2 class="text-lg font-bold">Other income</h2>
      @if (budget.otherIncome().length === 0) {
        <p class="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <svg lucideWallet [size]="16"></svg> No bonus, cash advance, or other inflow is saved.
        </p>
      } @else {
        <ul class="mt-3 space-y-3">
          @for (stream of budget.otherIncome(); track stream.id) {
            <li class="grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1.4fr_.8fr_.6fr_auto] sm:items-end">
              <div>
                <p class="font-semibold">{{ stream.name }}</p>
                <p class="text-xs text-slate-400">{{ otherDetail(stream) }}</p>
              </div>
              <label class="text-xs text-slate-400">
                Amount
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="stream.amount" (change)="updateAmount(stream, $event)" />
              </label>
              @if (stream.remainingMonths != null) {
                <label class="text-xs text-slate-400">
                  Months left
                  <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="1" [value]="stream.remainingMonths" (change)="updateMonths(stream, $event)" />
                </label>
              } @else {
                <span class="hidden sm:block"></span>
              }
              <p class="font-mono text-sm text-emerald-200 sm:pb-2">{{ stream.amount | php }}</p>
            </li>
          }
        </ul>
      }
    </section>

    @if (notice()) {
      <p class="mt-4 text-sm text-emerald-300">{{ notice() }}</p>
    }
  `,
})
export class IncomeComponent {
  readonly budget = inject(BudgetStateService);
  readonly notice = signal('');
  readonly error = signal('');
  readonly kind = signal('salary');
  readonly name = signal('');
  readonly amount = signal('');
  readonly payDay = signal('10');
  readonly totalDebt = signal('');
  readonly terms = signal('1');
  readonly dueDay = signal('30');
  readonly borrowedOn = signal('');
  readonly remarks = signal('');
  readonly receivedOn = signal('');
  readonly longDate = formatLongDate;

  isEmpty(): boolean {
    return this.budget.incomeStreams().length === 0 && this.budget.receivables().length === 0;
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  add(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    const amount = parseMoney(this.amount());
    if (!name) {
      this.error.set('Enter a name.');
      return;
    }
    if (amount <= 0) {
      this.error.set('Enter an amount greater than zero.');
      return;
    }
    if (this.kind() === 'salary') {
      const day = salaryDay(this.payDay());
      this.budget.addIncomeStream({
        name,
        amount,
        dayOfMonth: day,
        cutoffType: salaryCutoffType(day),
      });
      this.notice.set(`${name} was added to the ${ordinalDay(day)} cutoff.`);
    } else if (this.kind() === 'owe') {
      const total = parseMoney(this.totalDebt());
      const terms = Number(this.terms());
      const dueDay = Number(this.dueDay());
      if (total <= 0) {
        this.error.set('Enter the total they owe.');
        return;
      }
      if (!Number.isFinite(terms) || terms < 1) {
        this.error.set('Enter how many payment terms they have.');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.borrowedOn())) {
        this.error.set('Enter the date they borrowed the money.');
        return;
      }
      this.budget.addReceivable({
        name,
        totalDebt: total,
        paymentAmount: amount,
        terms,
        dueDayOfMonth: Number.isFinite(dueDay) ? dueDay : 30,
        borrowedOn: this.borrowedOn(),
        notes: this.remarks().trim() || undefined,
      });
      this.notice.set(`${name} was saved. Their payment is added to income after you log it as paid.`);
    } else {
      const receivedOn = this.receivedOn();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
        this.error.set('Enter the date this income is received.');
        return;
      }
      this.budget.addIncomeStream({
        name,
        amount,
        dayOfMonth: Number(receivedOn.slice(8, 10)),
        cutoffType: 'BONUS',
        isOneTime: true,
        specificDate: receivedOn,
      });
      this.notice.set(`${name} was added as other income.`);
    }
    this.error.set('');
    this.name.set('');
    this.amount.set('');
    this.totalDebt.set('');
    this.terms.set('1');
    this.remarks.set('');
    this.borrowedOn.set('');
    this.receivedOn.set('');
  }

  ordinal(day: number): string {
    return ordinalDay(day);
  }

  owePhrase(item: Receivable): string {
    const months = item.terms === 1 ? '1 month' : `${item.terms} months`;
    const due = item.dueDayOfMonth ? ` on the ${ordinalDay(item.dueDayOfMonth)}` : '';
    return `${formatLongDateAmount(item.paymentAmount)} each month for ${months}${due}`;
  }

  otherDetail(stream: IncomeStream): string {
    if (stream.cutoffType === 'CASH_ADVANCE' && stream.specificDate) return `One-time cash advance on ${formatLongDate(stream.specificDate)}`;
    if (stream.isOneTime && stream.specificDate) return `One-time on ${formatLongDate(stream.specificDate)}`;
    if (stream.cutoffType === '30TH_INFLOW') return `Every ${ordinalDay(stream.dayOfMonth)} · ${stream.remainingMonths ?? 0} months left`;
    if (stream.specificDate) return formatLongDate(stream.specificDate);
    return 'Other income';
  }

  updateAmount(stream: IncomeStream, event: Event): void {
    this.budget.updateIncome(stream.id, { amount: parseMoney((event.target as HTMLInputElement).value) });
    this.notice.set(`${stream.name} updated on upcoming cutoffs.`);
  }

  updateMonths(stream: IncomeStream, event: Event): void {
    this.budget.updateIncome(stream.id, { remainingMonths: Number((event.target as HTMLInputElement).value) });
    this.notice.set(`${stream.name} months remaining updated.`);
  }
}

function formatLongDateAmount(amount: number): string {
  return amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });
}

function salaryDay(value: string): number {
  const day = Number(value);
  if (day === 15 || day === 25 || day === 30) return day;
  return 10;
}

function salaryCutoffType(day: number): CutoffType {
  if (day === 15) return '15TH_CUTOFF';
  if (day === 25) return '25TH_CUTOFF';
  if (day === 30) return '30TH_CUTOFF';
  return '10TH_CUTOFF';
}
