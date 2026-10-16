import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePlus } from '@lucide/angular';
import { formatShortDate } from '../../core/dates';
import { formatPhp, parseMoney } from '../../core/money';
import { ACCOUNT_KIND_LABEL, CASH_DEPOSIT_ID, MoneyAccountKind } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

interface SavingCard {
  id: string;
  name: string;
  type: string;
  kind: MoneyAccountKind | 'CASH';
  balance: number;
  source: 'account' | 'cash' | 'orphan';
}

@Component({
  selector: 'app-savings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, WarningPopupComponent, ModalComponent, LucidePlus],
  template: `
    <section>
      <p class="text-sm text-slate-400">Money you hold</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Savings</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Each bank or e-wallet is a card. Tap + to add money. Tap the card to open its history.
      </p>
    </section>

    <section class="mt-6 rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5 sm:max-w-sm">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Total</p>
      <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.totalSavings() | php }}</p>
      <p class="mt-2 text-sm text-emerald-100/80">Banks, e-wallets, and cash on hand.</p>
    </section>

    @if (budget.accounts().length === 0) {
      <p class="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
        Register a bank or e-wallet first on <a routerLink="/accounts" class="font-semibold text-emerald-300">Banks / E-Wallet</a>, then add its balance here.
      </p>
    }

    @if (notice()) {
      <p class="mt-4 text-sm text-emerald-300">{{ notice() }}</p>
    }

    <section class="mt-6 grid max-w-2xl grid-cols-2 gap-3">
      @for (card of cards(); track card.id) {
        <article
          class="atm-card relative cursor-pointer overflow-hidden rounded-2xl p-3 shadow-sm transition hover:-translate-y-0.5"
          (click)="openHistory(card)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="h-5 w-7 rounded bg-gradient-to-br from-amber-300 to-amber-500"></div>
            @if (card.source !== 'orphan') {
              <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                (click)="openAdd(card, $event)"
                [attr.aria-label]="'Add balance to ' + card.name"
              >
                <svg lucidePlus [size]="14"></svg>
              </button>
            }
          </div>
          <p class="mt-3 truncate text-sm font-bold leading-tight text-slate-900">{{ card.name }}</p>
          <p class="atm-muted truncate text-[11px]">{{ card.type }}</p>
          <p class="mt-2 truncate font-mono text-sm font-semibold text-slate-900">{{ card.balance | php }}</p>
        </article>
      }
    </section>

    <app-modal [open]="adding() !== null" (closed)="closeAdd()">
      @if (adding(); as form) {
        <h2 class="text-xl font-bold">Add to {{ form.name }}</h2>
        <p class="mt-1 text-sm text-slate-400">This amount is added to the balance and written to history.</p>
        <form class="mt-4 grid gap-3" (submit)="saveAdd($event)">
          <label class="text-xs text-slate-400">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" placeholder="0.00" [value]="addAmount()" (input)="addAmount.set(text($event))" />
          </label>
          <app-warning [message]="error()" (closed)="error.set('')" />
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950">Add balance</button>
            <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="closeAdd()">Cancel</button>
          </div>
        </form>
      }
    </app-modal>

    <app-modal [open]="history() !== null" size="lg" align="center" (closed)="history.set(null)">
      @if (history(); as item) {
        <h2 class="text-xl font-bold">{{ historyTitle() }}</h2>
        <p class="mt-1 text-sm text-slate-400">Debit, credit, and running balance. Newest first.</p>
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
  readonly addAmount = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly history = signal<SavingCard | null>(null);
  readonly adding = signal<SavingCard | null>(null);
  readonly shortDate = formatShortDate;

  readonly cards = computed<SavingCard[]>(() => {
    const accounts = this.budget.accounts().map((account) => ({
      id: account.id,
      name: account.name,
      type: ACCOUNT_KIND_LABEL[account.kind],
      kind: account.kind,
      balance: this.budget.accountBalance(account.id),
      source: 'account' as const,
    }));
    const cash: SavingCard = {
      id: CASH_DEPOSIT_ID,
      name: 'Cash on hand',
      type: 'Cash',
      kind: 'CASH',
      balance: this.budget.cashOnHand(),
      source: 'cash',
    };
    const orphans = this.budget
      .bankSavings()
      .filter((item) => !item.accountId)
      .map((item) => ({
        id: item.id,
        name: item.bankName,
        type: item.accountName || 'Balance',
        kind: 'BANK' as const,
        balance: item.amount,
        source: 'orphan' as const,
      }));
    return [...accounts, cash, ...orphans];
  });

  readonly historyTitle = computed(() => this.history()?.name ?? '');

  readonly historyRows = computed(() => {
    const item = this.history();
    if (!item) return [];
    if (item.source === 'orphan') return this.budget.transactionsFor(item.id);
    return this.budget.transactionsForAccount(item.id);
  });

  readonly historyBalance = computed(() => this.history()?.balance ?? 0);

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  openHistory(card: SavingCard): void {
    this.history.set(card);
  }

  openAdd(card: SavingCard, event: Event): void {
    event.stopPropagation();
    this.error.set('');
    this.addAmount.set('');
    this.adding.set(card);
  }

  closeAdd(): void {
    this.adding.set(null);
    this.addAmount.set('');
    this.error.set('');
  }

  saveAdd(event: Event): void {
    event.preventDefault();
    const card = this.adding();
    if (!card) return;
    const amount = parseMoney(this.addAmount());
    if (amount <= 0) {
      this.error.set('Enter an amount greater than zero.');
      return;
    }
    if (card.source === 'cash') {
      this.budget.addCashOnHand(amount, 'Cash added');
      this.notice.set(`${formatPhp(amount)} was added to cash on hand.`);
    } else if (card.source === 'account') {
      const row = this.budget.addBankSaving({ accountId: card.id, amount });
      if (!row) return;
      this.notice.set(`${formatPhp(amount)} was added to ${card.name}. Balance is now ${formatPhp(row.amount)}.`);
    } else {
      this.error.set('Register this account on Banks / E-Wallet before adding a balance.');
      return;
    }
    this.closeAdd();
  }
}
