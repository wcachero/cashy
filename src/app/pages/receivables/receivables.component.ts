import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideHandCoins, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { formatLongDate, ordinalDay, shiftMonth } from '../../core/dates';
import { collectYears, rangeOverlapsPeriod } from '../../core/period';
import { parseMoney, round2 } from '../../core/money';
import { Receivable } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { PeriodFilterComponent } from '../../shared/period-filter.component';
import { PhpPipe } from '../../shared/php.pipe';

@Component({
  selector: 'app-receivables',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, PeriodFilterComponent, LucideHandCoins, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Money other people owe you</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Owes you</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Record who owes you. The payment is added to income only after you log that they paid.
      </p>
    </section>

    <section class="mt-6 rounded-3xl border border-sky-400/30 bg-sky-400/10 p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">Still owed to you</p>
          <p class="mt-2 font-mono text-2xl font-bold">{{ owedTotal() | php }}</p>
          <p class="mt-2 text-sm text-sky-100/80">{{ visible().length }} {{ visible().length === 1 ? 'person' : 'people' }}</p>
        </div>
        <app-period-filter [(month)]="month" [(year)]="year" [years]="years()" />
      </div>
    </section>

    <form class="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-6" (submit)="add($event)">
      <label class="text-xs text-slate-400">
        Name
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Who owes you" [value]="name()" (input)="name.set(text($event))" />
      </label>
      <label class="text-xs text-slate-400">
        Total debt
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="totalDebt()" (input)="totalDebt.set(text($event))" />
      </label>
      <label class="text-xs text-slate-400">
        Payment each term
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="paymentAmount()" (input)="paymentAmount.set(text($event))" />
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
      <label class="text-xs text-slate-400 sm:col-span-2 lg:col-span-5">
        Remarks
        <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Land installment, agreement notes…" [value]="remarks()" (input)="remarks.set(text($event))" />
      </label>
      <div class="flex items-end">
        <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Add
        </button>
      </div>
      @if (error()) {
        <p class="text-sm text-rose-300 sm:col-span-2 lg:col-span-6">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="text-sm text-emerald-300 sm:col-span-2 lg:col-span-6">{{ notice() }}</p>
      }
    </form>

    @if (budget.receivables().length === 0) {
      <p class="mt-4 flex items-center gap-2 text-sm text-slate-500">
        <svg lucideHandCoins [size]="16"></svg> Nobody is recorded yet.
      </p>
    } @else if (visible().length === 0) {
      <p class="mt-4 text-sm text-slate-500">Nobody matches this month and year.</p>
    } @else {
      <ul class="mt-4 space-y-3">
        @for (item of visible(); track item.id) {
          <li class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold">{{ item.name }}</h2>
                <p class="mt-1 text-sm text-slate-400">{{ termPhrase(item) }}</p>
                @if (item.borrowedOn) {
                  <p class="mt-1 text-sm text-slate-400">Borrowed {{ borrowedLabel(item.borrowedOn) }}</p>
                }
                @if (item.notes) {
                  <p class="mt-1 text-sm text-slate-300">{{ item.notes }}</p>
                }
              </div>
              <p class="font-mono text-lg text-sky-200">{{ remaining(item) | php }} left</p>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt class="text-xs text-slate-500">Total debt</dt>
                <dd class="font-mono">{{ item.totalDebt | php }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Payment term</dt>
                <dd class="font-mono">{{ item.paymentAmount | php }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Terms</dt>
                <dd>{{ item.terms }} {{ item.terms === 1 ? 'month' : 'months' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Received</dt>
                <dd class="font-mono">{{ item.amountReceived | php }}</dd>
              </div>
            </dl>
            <div class="mt-4 flex flex-wrap items-end gap-2">
              <label class="text-xs text-slate-400">
                Payment received
                <input class="mt-1 w-36 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="item.paymentAmount" #received />
              </label>
              <button type="button" class="rounded-2xl bg-white px-3 py-2 text-sm font-bold text-slate-950" (click)="receive(item.id, received.value)">Log payment</button>
              <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="budget.removeReceivable(item.id)">
                <svg lucideTrash2 [size]="14"></svg> Remove
              </button>
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class ReceivablesComponent {
  readonly budget = inject(BudgetStateService);
  readonly name = signal('');
  readonly totalDebt = signal('');
  readonly paymentAmount = signal('');
  readonly terms = signal('1');
  readonly dueDay = signal('');
  readonly borrowedOn = signal('');
  readonly remarks = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly month = signal('all');
  readonly year = signal('all');

  readonly years = computed(() =>
    collectYears(
      [],
      this.budget.receivables().map((item) => ({ start: item.borrowedOn, end: receivableEnd(item) })),
    ),
  );

  readonly visible = computed(() =>
    this.budget.receivables().filter((item) => rangeOverlapsPeriod(item.borrowedOn, receivableEnd(item), this.month(), this.year())),
  );

  owedTotal(): number {
    return round2(this.visible().reduce((sum, item) => sum + Math.max(0, item.totalDebt - item.amountReceived), 0));
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  remaining(item: Receivable): number {
    return round2(Math.max(0, item.totalDebt - item.amountReceived));
  }

  termPhrase(item: Receivable): string {
    const months = item.terms === 1 ? '1 month' : `${item.terms} months`;
    const due = item.dueDayOfMonth ? ` on the ${ordinalDay(item.dueDayOfMonth)}` : '';
    return `${item.paymentAmount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })} each month for ${months}${due}`;
  }

  borrowedLabel(iso: string): string {
    return formatLongDate(iso);
  }

  add(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    const total = parseMoney(this.totalDebt());
    const payment = parseMoney(this.paymentAmount());
    const terms = Number(this.terms());
    if (!name) {
      this.error.set('Enter the name of the person who owes you.');
      return;
    }
    if (total <= 0) {
      this.error.set('Enter the total debt.');
      return;
    }
    if (payment <= 0) {
      this.error.set('Enter the payment for each term.');
      return;
    }
    if (!Number.isFinite(terms) || terms < 1) {
      this.error.set('Enter how many payment terms they have.');
      return;
    }
    const borrowedOn = this.borrowedOn();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(borrowedOn)) {
      this.error.set('Enter the date they borrowed the money.');
      return;
    }
    const dueDay = Number(this.dueDay());
    this.budget.addReceivable({
      name,
      totalDebt: total,
      paymentAmount: payment,
      terms,
      borrowedOn,
      notes: this.remarks().trim() || undefined,
      dueDayOfMonth: Number.isFinite(dueDay) && dueDay >= 1 ? dueDay : undefined,
    });
    this.name.set('');
    this.totalDebt.set('');
    this.paymentAmount.set('');
    this.terms.set('1');
    this.dueDay.set('');
    this.borrowedOn.set('');
    this.remarks.set('');
    this.error.set('');
  }

  receive(id: string, raw: string): void {
    const message = this.budget.recordReceivablePayment(id, parseMoney(raw));
    this.notice.set(message || 'Enter a payment that is still owed.');
    this.error.set('');
  }
}

function receivableEnd(item: Receivable): string | undefined {
  if (!item.borrowedOn) return undefined;
  const day = item.dueDayOfMonth ?? Number(item.borrowedOn.slice(8, 10));
  return shiftMonth(item.borrowedOn, Math.max(0, item.terms - 1), day);
}
