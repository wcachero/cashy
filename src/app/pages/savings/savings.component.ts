import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideBanknote, LucideClipboardList, LucidePiggyBank, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { formatShortDate } from '../../core/dates';
import { formatPhp, parseMoney, round2 } from '../../core/money';
import { BankSaving } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

@Component({
  selector: 'app-savings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, WarningPopupComponent, ModalComponent, LucidePiggyBank, LucideBanknote, LucidePlus, LucideTrash2, LucideClipboardList],
  template: `
    <section>
      <p class="text-sm text-slate-400">Money you hold</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Savings</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Balances in each registered bank or e-wallet, plus cash on hand. Pick a registered account to add money. History is a debit/credit record and cannot be edited.
      </p>
    </section>

    <section class="mt-6 grid gap-3 sm:grid-cols-3">
      <article class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Total</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.totalSavings() | php }}</p>
        <p class="mt-2 text-sm text-emerald-100/80">Banks, e-wallets, and cash on hand.</p>
      </article>
      <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Banks & e-wallets</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.otherBankSavings() | php }}</p>
        <p class="mt-2 text-sm text-slate-400">{{ budget.bankSavings().length }} {{ budget.bankSavings().length === 1 ? 'balance' : 'balances' }} recorded.</p>
      </article>
      <article class="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5">
        <p class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100"><svg lucideBanknote [size]="14"></svg> Cash on hand</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.cashOnHand() | php }}</p>
        <p class="mt-2 text-sm text-amber-50/80">Withdrawals add to it; bills paid in cash take from it.</p>
      </article>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucideBanknote [size]="18" class="text-amber-200"></svg>
        <h2 class="text-lg font-bold">Cash on hand</h2>
      </div>
      <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" (submit)="addCash($event)">
        <label class="text-xs text-slate-400">
          Amount
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" placeholder="0.00" [value]="cashAmount()" (input)="cashAmount.set(text($event))" />
        </label>
        <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Add cash
        </button>
        <button type="button" class="rounded-2xl border border-white/15 px-4 py-2.5 text-sm" (click)="setCash()">Set as balance</button>
        <app-warning [message]="cashError()" (closed)="cashError.set('')" />
      </form>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucidePiggyBank [size]="18" class="text-emerald-300"></svg>
        <h2 class="text-lg font-bold">Bank and e-wallet balances</h2>
      </div>
      @if (budget.accounts().length === 0) {
        <p class="mt-3 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
          Register a bank or e-wallet first on <a routerLink="/accounts" class="font-semibold text-emerald-300">Banks / E-Wallet</a>, then record its balance here.
        </p>
      } @else {
        <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-3" (submit)="add($event)">
          <label class="text-xs text-slate-400">
            Account
            <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="accountId.set(choice($event))">
              <option value="" [selected]="!accountId()">Choose a registered bank or e-wallet</option>
              @for (account of budget.accounts(); track account.id) {
                <option [value]="account.id" [selected]="account.id === accountId()">{{ budget.accountLabel(account.id) }}</option>
              }
            </select>
          </label>
          <label class="text-xs text-slate-400">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" [value]="amount()" (input)="amount.set(text($event))" />
          </label>
          <div class="flex items-end">
            <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
              <svg lucidePlus [size]="16"></svg> Add balance
            </button>
          </div>
          <p class="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">The amount is added to that registered account. A credit is written to history and cannot be changed later.</p>
          <app-warning [message]="error()" (closed)="error.set('')" />
        </form>
      }

      @if (notice()) {
        <p class="mt-3 text-sm text-emerald-300">{{ notice() }}</p>
      }

      @if (budget.bankSavings().length === 0) {
        <p class="mt-3 text-sm text-slate-500">No bank or e-wallet balance is recorded.</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (item of budget.bankSavings(); track item.id) {
            <li class="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <label class="text-xs text-slate-400">
                Account
                <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="relink(item.id, $event)">
                  @if (!item.accountId) {
                    <option value="" [selected]="true">{{ item.bankName }} · {{ item.accountName }} (not registered)</option>
                  }
                  @for (account of budget.accounts(); track account.id) {
                    <option [value]="account.id" [selected]="account.id === item.accountId">{{ budget.accountLabel(account.id) }}</option>
                  }
                </select>
              </label>
              <div class="text-xs text-slate-400">
                Balance
                <p class="mt-1 rounded-xl border border-white/5 bg-white/5 px-3 py-2 font-mono text-sm text-emerald-200 sm:w-36">{{ item.amount | php }}</p>
              </div>
              <button type="button" class="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm" (click)="history.set(item)">
                <svg lucideClipboardList [size]="14"></svg> History
              </button>
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

    <app-modal [open]="history() !== null" size="lg" (closed)="history.set(null)">
      @if (history(); as item) {
        <h2 class="text-xl font-bold">{{ historyTitle() }}</h2>
        <p class="mt-1 text-sm text-slate-400">Debit, credit, and running balance. Newest first. This record cannot be edited.</p>
        <p class="mt-3 font-mono text-lg font-semibold text-emerald-200">{{ historyBalance() | php }}</p>
        @if (historyRows().length === 0) {
          <p class="mt-4 text-sm text-slate-400">No movements yet. Add a balance, receive a deposit, pay a bill, or withdraw to start this ledger.</p>
        } @else {
          <div class="mt-4 overflow-x-auto">
            <table class="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr class="border-b border-white/10 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  <th class="py-2 pr-3 font-semibold">Date</th>
                  <th class="py-2 pr-3 font-semibold">Description</th>
                  @if (showAccountCol()) {
                    <th class="py-2 pr-3 font-semibold">Account</th>
                  }
                  <th class="py-2 pr-3 text-right font-semibold">Credit</th>
                  <th class="py-2 pr-3 text-right font-semibold">Debit</th>
                  <th class="py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                @for (tx of historyRows(); track tx.id) {
                  <tr class="border-b border-white/5">
                    <td class="whitespace-nowrap py-2 pr-3 text-slate-300">{{ shortDate(tx.date) }}</td>
                    <td class="py-2 pr-3">{{ tx.description }}</td>
                    @if (showAccountCol()) {
                      <td class="py-2 pr-3 text-slate-400">{{ accountNameFor(tx.savingsId) }}</td>
                    }
                    <td class="whitespace-nowrap py-2 pr-3 text-right font-mono text-emerald-200">{{ tx.type === 'CREDIT' ? (tx.amount | php) : '—' }}</td>
                    <td class="whitespace-nowrap py-2 pr-3 text-right font-mono text-rose-200">{{ tx.type === 'DEBIT' ? (tx.amount | php) : '—' }}</td>
                    <td class="whitespace-nowrap py-2 text-right font-mono">{{ tx.balanceAfter | php }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <div class="mt-5">
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="history.set(null)">Close</button>
        </div>
      }
    </app-modal>
  `,
})
export class SavingsComponent {
  readonly budget = inject(BudgetStateService);
  readonly accountId = signal('');
  readonly amount = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly cashAmount = signal('');
  readonly cashError = signal('');
  readonly history = signal<BankSaving | null>(null);
  readonly shortDate = formatShortDate;

  readonly historyTitle = computed(() => {
    const item = this.history();
    if (!item) return '';
    if (item.accountId) return this.budget.accountLabel(item.accountId) || `${item.bankName} · ${item.accountName}`;
    return `${item.bankName} · ${item.accountName}`;
  });

  readonly historyRows = computed(() => {
    const item = this.history();
    if (!item) return [];
    return item.accountId ? this.budget.transactionsForAccount(item.accountId) : this.budget.transactionsFor(item.id);
  });

  readonly historyBalance = computed(() => {
    const item = this.history();
    if (!item) return 0;
    return item.accountId ? this.budget.accountBalance(item.accountId) : item.amount;
  });

  readonly showAccountCol = computed(() => {
    const item = this.history();
    return Boolean(item?.accountId && this.budget.savingsForAccount(item.accountId).length > 1);
  });

  accountNameFor(savingsId: string): string {
    return this.budget.bankSavings().find((item) => item.id === savingsId)?.accountName ?? '';
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  add(event: Event): void {
    event.preventDefault();
    const accountId = this.accountId();
    if (!accountId) {
      this.error.set('Choose the bank or e-wallet.');
      return;
    }
    const amount = parseMoney(this.amount());
    if (amount <= 0) {
      this.error.set('Enter the balance in that account.');
      return;
    }
    const existed = this.budget.bankSavings().some((item) => item.accountId === accountId);
    const row = this.budget.addBankSaving({ accountId, amount });
    if (!row) return;
    this.notice.set(
      existed
        ? `${formatPhp(amount)} was added to ${this.budget.accountLabel(accountId)}. Balance is now ${formatPhp(row.amount)}.`
        : `${this.budget.accountLabel(accountId)} was recorded at ${formatPhp(row.amount)}.`,
    );
    this.amount.set('');
    this.error.set('');
  }

  addCash(event: Event): void {
    event.preventDefault();
    const amount = parseMoney(this.cashAmount());
    if (amount <= 0) {
      this.cashError.set('Enter the cash amount.');
      return;
    }
    this.budget.setCashOnHand(round2(this.budget.cashOnHand() + amount));
    this.cashAmount.set('');
    this.cashError.set('');
  }

  setCash(): void {
    const amount = parseMoney(this.cashAmount());
    if (amount < 0 || this.cashAmount().trim() === '') {
      this.cashError.set('Enter the cash you are holding right now.');
      return;
    }
    this.budget.setCashOnHand(amount);
    this.cashAmount.set('');
    this.cashError.set('');
  }

  relink(id: string, event: Event): void {
    const accountId = this.choice(event);
    if (accountId) this.budget.updateBankSaving(id, { accountId });
  }
}
