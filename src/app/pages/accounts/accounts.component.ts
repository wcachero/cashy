import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideBuilding2, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { ACCOUNT_KIND_LABEL, MoneyAccount, MoneyAccountKind, asAccountKind } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

const KIND_OPTIONS = (Object.keys(ACCOUNT_KIND_LABEL) as MoneyAccountKind[]).map((kind) => ({ kind, label: ACCOUNT_KIND_LABEL[kind] }));

@Component({
  selector: 'app-accounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, WarningPopupComponent, ModalComponent, LucideBuilding2, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Where your money sits</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Banks / E-Wallet</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Register the banks and e-wallets you use. Income lands in the one you pick, bills paid by bank transfer come out of it, and its balance shows on Savings.
      </p>
    </section>

    <section class="mt-6 grid gap-3 sm:grid-cols-2">
      <article class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Banks & e-wallets</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.otherBankSavings() | php }}</p>
        <p class="mt-2 text-sm text-emerald-100/80">{{ budget.accounts().length }} registered.</p>
      </article>
      <article class="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">Cash on hand</p>
        <p class="mt-2 font-mono text-2xl font-bold text-white">{{ budget.cashOnHand() | php }}</p>
        <p class="mt-2 text-sm text-amber-50/80">Withdrawals add to it. <a routerLink="/savings" class="font-semibold text-amber-100 underline">Adjust on Savings</a>.</p>
      </article>
    </section>

    <section class="mt-8">
      <div class="flex items-center gap-2">
        <svg lucideBuilding2 [size]="18" class="text-emerald-300"></svg>
        <h2 class="text-lg font-bold">Register a bank or e-wallet</h2>
      </div>
      <form class="mt-3 grid gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" (submit)="add($event)">
        <label class="text-xs text-slate-400">
          Name
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="BPI, GCash, Maya" [value]="name()" (input)="name.set(text($event))" />
        </label>
        <label class="text-xs text-slate-400">
          Type
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white sm:w-44" (change)="kind.set(pickKind($event))">
            @for (option of kinds; track option.kind) {
              <option [value]="option.kind" [selected]="option.kind === kind()">{{ option.label }}</option>
            }
          </select>
        </label>
        <p class="text-xs text-slate-500 sm:col-span-3">A payroll account is the bank your salary is deposited to. Link it on Income so each cutoff lands there.</p>
        <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Register
        </button>
        <app-warning [message]="error()" (closed)="error.set('')" />
      </form>

      @if (rows().length === 0) {
        <p class="mt-3 text-sm text-slate-500">Nothing is registered yet.</p>
      } @else {
        <ul class="mt-3 space-y-2">
          @for (row of rows(); track row.id) {
            <li class="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <label class="text-xs text-slate-400">
                Name
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="row.name" (change)="rename(row.id, $event)" />
              </label>
              <label class="text-xs text-slate-400">
                Type
                <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white sm:w-44" (change)="retype(row.id, $event)">
                  @for (option of kinds; track option.kind) {
                    <option [value]="option.kind" [selected]="row.kind === option.kind">{{ option.label }}</option>
                  }
                </select>
              </label>
              <div class="text-xs text-slate-400">
                Balance
                <p class="mt-1 rounded-xl border border-white/5 bg-white/5 px-3 py-2 font-mono text-sm text-emerald-200 sm:w-36">{{ row.balance | php }}</p>
              </div>
              <button type="button" class="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm text-rose-200" (click)="pendingRemove.set(row)">
                <svg lucideTrash2 [size]="14"></svg> Remove
              </button>
              <p class="text-xs text-slate-500 sm:col-span-4">
                {{ row.incomeNames.length ? 'Receives ' + row.incomeNames.join(', ') + '.' : 'No income is deposited here yet.' }}
                {{ row.savingsCount }} savings {{ row.savingsCount === 1 ? 'row' : 'rows' }}.
              </p>
            </li>
          }
        </ul>
      }
    </section>

    <app-modal [open]="pendingRemove() !== null" (closed)="pendingRemove.set(null)">
      @if (pendingRemove(); as row) {
        <h2 class="text-xl font-bold">Remove {{ row.name }}?</h2>
        <p class="mt-2 text-sm text-slate-400">
          Its savings rows stay on the Savings page under the name "{{ row.name }}", and income deposited here stops being credited. Bills already paid from it are kept as history.
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-rose-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="confirmRemove()">Remove</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="pendingRemove.set(null)">Cancel</button>
        </div>
      }
    </app-modal>
  `,
})
export class AccountsComponent {
  readonly budget = inject(BudgetStateService);
  readonly name = signal('');
  readonly kind = signal<MoneyAccountKind>('BANK');
  readonly kinds = KIND_OPTIONS;
  readonly error = signal('');
  readonly pendingRemove = signal<MoneyAccount | null>(null);

  readonly rows = computed(() =>
    this.budget.accounts().map((account) => ({
      ...account,
      balance: this.budget.accountBalance(account.id),
      savingsCount: this.budget.savingsForAccount(account.id).length,
      incomeNames: this.budget
        .incomeStreams()
        .filter((stream) => stream.accountId === account.id)
        .map((stream) => stream.name),
    })),
  );

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  pickKind(event: Event): MoneyAccountKind {
    return asAccountKind(this.choice(event));
  }

  add(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    if (!name) {
      this.error.set('Enter the bank or e-wallet name.');
      return;
    }
    if (this.budget.accounts().some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      this.error.set(`${name} is already registered.`);
      return;
    }
    this.budget.addAccount({ name, kind: this.kind() });
    this.name.set('');
    this.error.set('');
  }

  rename(id: string, event: Event): void {
    this.budget.updateAccount(id, { name: this.text(event) });
  }

  retype(id: string, event: Event): void {
    this.budget.updateAccount(id, { kind: asAccountKind(this.choice(event)) });
  }

  confirmRemove(): void {
    const row = this.pendingRemove();
    if (!row) return;
    this.budget.removeAccount(row.id);
    this.pendingRemove.set(null);
  }
}
