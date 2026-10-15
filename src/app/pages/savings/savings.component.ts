import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucidePiggyBank, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { parseMoney } from '../../core/money';
import { BudgetStateService } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

@Component({
  selector: 'app-savings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, WarningPopupComponent, LucidePiggyBank, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Money set aside</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Savings</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">Balances you keep in another bank.</p>
    </section>

    <section class="mt-6">
      <article class="max-w-md rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Total savings</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.totalSavings() | php }}</p>
        <p class="mt-2 text-sm text-emerald-100/80">Recorded bank balances only.</p>
      </article>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucidePiggyBank [size]="18" class="text-emerald-300"></svg>
        <h2 class="text-lg font-bold">Savings in another bank</h2>
      </div>
      <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="add($event)">
        <label class="text-xs text-slate-400">
          Bank
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="BPI, Maya, CIMB" [value]="bankName()" (input)="bankName.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Account
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Savings" [value]="accountName()" (input)="accountName.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Amount
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="amount()" (input)="amount.set(text($event))" />
        </label>
        <div class="flex items-end">
          <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
            <svg lucidePlus [size]="16"></svg> Add savings
          </button>
        </div>
        <app-warning [message]="error()" (closed)="error.set('')" />
      </form>

      @if (budget.bankSavings().length === 0) {
        <p class="mt-3 text-sm text-slate-500">No other-bank savings yet.</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (item of budget.bankSavings(); track item.id) {
            <li class="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <label class="text-xs text-slate-400">
                Bank
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="item.bankName" (change)="renameBank(item.id, $event)" />
              </label>
              <label class="text-xs text-slate-400">
                Account
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="item.accountName" (change)="renameAccount(item.id, $event)" />
              </label>
              <label class="text-xs text-slate-400">
                Amount
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white sm:w-36" type="number" min="0" step="0.01" [value]="item.amount" (change)="changeAmount(item.id, $event)" />
              </label>
              <button type="button" class="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="budget.removeBankSaving(item.id)">
                <svg lucideTrash2 [size]="14"></svg> Remove
              </button>
              @if (item.notes) {
                <p class="text-xs text-slate-500 sm:col-span-4">{{ item.notes }}</p>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class SavingsComponent {
  readonly budget = inject(BudgetStateService);
  readonly bankName = signal('');
  readonly accountName = signal('');
  readonly amount = signal('');
  readonly error = signal('');

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  add(event: Event): void {
    event.preventDefault();
    const bank = this.bankName().trim();
    if (!bank) {
      this.error.set('Enter the bank name.');
      return;
    }
    const amount = parseMoney(this.amount());
    if (amount <= 0) {
      this.error.set('Enter the amount saved in that bank.');
      return;
    }
    this.budget.addBankSaving({
      bankName: bank,
      accountName: this.accountName(),
      amount,
    });
    this.bankName.set('');
    this.accountName.set('');
    this.amount.set('');
    this.error.set('');
  }

  renameBank(id: string, event: Event): void {
    this.budget.updateBankSaving(id, { bankName: this.text(event) });
  }

  renameAccount(id: string, event: Event): void {
    this.budget.updateBankSaving(id, { accountName: this.text(event) });
  }

  changeAmount(id: string, event: Event): void {
    this.budget.updateBankSaving(id, { amount: parseMoney(this.text(event)) });
  }
}
