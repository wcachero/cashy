import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideBuilding2, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { ACCOUNT_KIND_LABEL, MoneyAccount, MoneyAccountKind, asAccountKind } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

const KIND_OPTIONS = (Object.keys(ACCOUNT_KIND_LABEL) as MoneyAccountKind[]).map((kind) => ({ kind, label: ACCOUNT_KIND_LABEL[kind] }));

@Component({
  selector: 'app-accounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WarningPopupComponent, ModalComponent, LucideBuilding2, LucidePlus, LucideTrash2],
  template: `
    <section>
      <p class="text-sm text-slate-400">Where your money sits</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Banks / E-Wallet</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Register a bank or e-wallet, then it shows as a card. Income lands here and the balance is on Savings.
      </p>
    </section>

    <section class="mt-6">
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
          Account type
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white sm:w-44" (change)="kind.set(pickKind($event))">
            @for (option of kinds; track option.kind) {
              <option [value]="option.kind" [selected]="option.kind === kind()">{{ option.label }}</option>
            }
          </select>
        </label>
        <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Register
        </button>
        <app-warning [message]="error()" (closed)="error.set('')" />
      </form>

      @if (rows().length === 0) {
        <p class="mt-4 text-sm text-slate-500">Nothing is registered yet.</p>
      } @else {
        <section class="mt-6 grid max-w-2xl grid-cols-2 gap-3">
          @for (row of rows(); track row.id) {
            <article class="atm-card relative overflow-hidden rounded-2xl p-3 shadow-sm">
              <div class="flex items-start justify-between gap-2">
                <div class="h-5 w-7 rounded bg-gradient-to-br from-amber-300 to-amber-500"></div>
                <button
                  type="button"
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-rose-600 hover:bg-rose-50"
                  (click)="pendingRemove.set(row)"
                  [attr.aria-label]="'Remove ' + row.name"
                >
                  <svg lucideTrash2 [size]="14"></svg>
                </button>
              </div>
              <p class="mt-3 truncate text-sm font-bold leading-tight text-slate-900">{{ row.name }}</p>
              <p class="atm-muted truncate text-[11px]">{{ kindLabel(row.kind) }}</p>
            </article>
          }
        </section>
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
      incomeNames: this.budget
        .incomeStreams()
        .filter((stream) => stream.accountId === account.id)
        .map((stream) => stream.name),
    })),
  );

  kindLabel(kind: MoneyAccountKind): string {
    return ACCOUNT_KIND_LABEL[kind];
  }

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

  confirmRemove(): void {
    const row = this.pendingRemove();
    if (!row) return;
    this.budget.removeAccount(row.id);
    this.pendingRemove.set(null);
  }
}
