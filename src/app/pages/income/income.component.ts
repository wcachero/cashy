import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideBanknote, LucideCheck, LucideChevronLeft, LucideChevronRight, LucideHandCoins, LucidePencil, LucidePlus, LucideTrash2, LucideWallet } from '@lucide/angular';
import { formatLongDate, formatShortDate, ordinalDay, shiftMonth, todayIso } from '../../core/dates';
import { formatPhp, parseMoney, round2 } from '../../core/money';
import { collectYears, dateInPeriod } from '../../core/period';
import { CASH_DEPOSIT_ID, CutoffType, IncomeStream, PaycheckCycle, Receivable } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { PhpPipe } from '../../shared/php.pipe';
import { ModalComponent } from '../../shared/modal.component';
import { PeriodFilterComponent } from '../../shared/period-filter.component';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-income',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PhpPipe, WarningPopupComponent, ModalComponent, PeriodFilterComponent, LucideWallet, LucideHandCoins, LucidePlus, LucidePencil, LucideTrash2, LucideBanknote, LucideCheck, LucideChevronLeft, LucideChevronRight],
  template: `
    <section>
      <p class="text-sm text-slate-400">What funds each cutoff</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Income</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Each deposit is for one cutoff and can be a different amount. Linked banks, e-wallets, and cash on hand are credited when the money is received.
      </p>
    </section>

    @if (isEmpty() && budget.hasDepositSource()) {
      <p class="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
        Nothing is saved yet. Add a deposit for a cutoff, someone who owes you, or other income. You can also import a plan from Settings.
      </p>
    }

    @if (!budget.hasDepositSource()) {
      <form class="mt-6 grid gap-3 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="saveDestination($event)">
        <div class="sm:col-span-2 lg:col-span-4">
          <h2 class="text-lg font-bold">Add where income lands first</h2>
          <p class="mt-1 text-sm text-amber-50/80">Register a bank or e-wallet, or use cash on hand. After that you can add income.</p>
        </div>
        <label class="text-xs text-slate-400">
          Type
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="destKind()" (change)="destKind.set(pickDestKind($event))">
            <option value="BANK">Bank</option>
            <option value="E_WALLET">E-wallet</option>
            <option value="CASH">Cash on hand</option>
          </select>
        </label>
        @if (destKind() === 'CASH') {
          <label class="text-xs text-slate-400">
            Opening amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white" type="number" min="0" step="0.01" placeholder="0.00" [value]="destCash()" (input)="destCash.set(text($event))" />
          </label>
        } @else {
          <label class="text-xs text-slate-400">
            Name
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [placeholder]="destKind() === 'E_WALLET' ? 'GCash, Maya' : 'BPI, BDO'" [value]="destName()" (input)="destName.set(text($event))" />
          </label>
        }
        <div class="flex items-end">
          <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
            <svg lucidePlus [size]="16"></svg> {{ destKind() === 'CASH' ? 'Use cash on hand' : 'Register and continue' }}
          </button>
        </div>
        <app-warning [message]="destError()" (closed)="destError.set('')" />
      </form>
    } @else {
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
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="cycleId.set(choice($event))">
            @for (group of cutoffGroups(); track group.year) {
              <optgroup [label]="group.year">
                @for (row of group.rows; track row.id) {
                  <option [value]="row.id" [selected]="row.id === selectedCycleId()">{{ row.label }}</option>
                }
              </optgroup>
            }
          </select>
        </label>
        <label class="text-xs text-slate-400">
          Date received
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" type="date" [value]="receivedOn()" (input)="receivedOn.set(text($event))" />
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
        <label class="text-xs text-slate-400">
          Cutoff
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="cycleId.set(choice($event))">
            @for (group of cutoffGroups(); track group.year) {
              <optgroup [label]="group.year">
                @for (row of group.rows; track row.id) {
                  <option [value]="row.id" [selected]="row.id === selectedCycleId()">{{ row.label }}</option>
                }
              </optgroup>
            }
          </select>
        </label>
      }
      @if (kind() !== 'owe') {
        <label class="text-xs text-slate-400">
          Deposited to
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" (change)="accountId.set(choice($event))">
            <option value="" [selected]="!accountId()">Choose bank, e-wallet, or cash</option>
            <option [value]="cashId" [selected]="accountId() === cashId">Cash on hand · {{ budget.cashOnHand() | php }}</option>
            @for (account of budget.accounts(); track account.id) {
              <option [value]="account.id" [selected]="account.id === accountId()">{{ budget.accountLabel(account.id) }} · {{ budget.accountBalance(account.id) | php }}</option>
            }
          </select>
        </label>
        <p class="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">This amount is only for the cutoff you pick. The next cutoff can be a different amount, and it is added to the linked bank, e-wallet, or cash on hand.</p>
      }
      <div class="flex items-end">
        <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950">
          <svg lucidePlus [size]="16"></svg> Add income
        </button>
      </div>
      <app-warning [message]="error()" (closed)="error.set('')" />
    </form>
    }

    @if (notice()) {
      <p class="mt-4 text-sm text-emerald-300">{{ notice() }}</p>
    }

    <section class="mt-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold">Income history</h2>
          <p class="mt-1 text-sm text-slate-400">Every deposit with the date it was received. Salary can change each cutoff.</p>
        </div>
        <app-period-filter [(month)]="month" [(year)]="year" [years]="years()" />
      </div>
      @if (filteredReceipts().length === 0) {
        <p class="mt-3 text-sm text-slate-500">No income deposits in this period yet.</p>
      } @else {
        <p class="mt-2 text-sm text-slate-400">{{ filteredReceipts().length }} {{ filteredReceipts().length === 1 ? 'deposit' : 'deposits' }} · {{ filteredTotal() | php }}</p>
        <div class="mt-3 overflow-x-auto rounded-3xl border border-white/10">
          <table class="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr class="border-b border-white/10 bg-white/5 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                <th class="px-3 py-2 font-semibold">Date</th>
                <th class="px-3 py-2 font-semibold">Kind</th>
                <th class="px-3 py-2 font-semibold">Name</th>
                <th class="px-3 py-2 font-semibold">Cutoff</th>
                <th class="px-3 py-2 font-semibold">Deposited to</th>
                <th class="px-3 py-2 text-right font-semibold">Amount</th>
                <th class="px-3 py-2 font-semibold"><span class="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of pageItems(); track row.id) {
                <tr class="border-b border-white/5">
                  <td class="whitespace-nowrap px-3 py-2 text-slate-300">{{ shortDate(row.receivedOn) }}</td>
                  <td class="px-3 py-2">{{ row.kind === 'salary' ? 'Salary cutoff' : 'Other' }}</td>
                  <td class="px-3 py-2">{{ row.name }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-slate-400">{{ shortDate(row.cutoffDate) }}</td>
                  <td class="px-3 py-2 text-slate-400">{{ budget.accountLabel(row.accountId) || '—' }}{{ row.credited ? '' : ' · pending' }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-right font-mono text-emerald-200">{{ row.amount | php }}</td>
                  <td class="px-3 py-2 text-right">
                    <button type="button" class="text-xs text-rose-200" (click)="askRemove('receipt', row.id, row.name)">Remove</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (pageCount() > 1) {
          <div class="mt-3 flex items-center justify-end gap-2">
            <button type="button" class="rounded-xl border border-white/15 p-2 disabled:opacity-40" [disabled]="page() <= 1" (click)="page.set(page() - 1)">
              <svg lucideChevronLeft [size]="16"></svg>
            </button>
            <p class="text-xs text-slate-400">{{ page() }} / {{ pageCount() }}</p>
            <button type="button" class="rounded-xl border border-white/15 p-2 disabled:opacity-40" [disabled]="page() >= pageCount()" (click)="page.set(page() + 1)">
              <svg lucideChevronRight [size]="16"></svg>
            </button>
          </div>
        }
      }
    </section>

    @if (budget.salaryIncome().length) {
    <section class="mt-6">
      <h2 class="text-lg font-bold">Repeating salary (plan)</h2>
      <p class="mt-1 text-sm text-slate-400">These expected amounts still sit on upcoming cutoffs. New deposits above do not copy to the next cutoff.</p>
        <ul class="mt-3 space-y-3">
          @for (stream of budget.salaryIncome(); track stream.id) {
            <li class="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4">
              <div>
                <p class="font-semibold">{{ stream.name }}</p>
                <p class="text-xs text-slate-400">Repeating every {{ ordinal(stream.dayOfMonth) }} · {{ stream.amount | php }} on upcoming cutoffs{{ depositLabel(stream) }}</p>
                @if (latestArrived(stream); as cycle) {
                  <p class="mt-1 text-xs" [class.text-emerald-200]="cycle.actualIncome != null" [class.text-slate-500]="cycle.actualIncome == null">
                    @if (cycle.actualIncome != null) {
                      {{ shortDate(cycle.cutoffDate) }} cutoff: received {{ cycle.actualIncome | php }} ({{ cycle.baseIncome | php }} expected).
                    } @else {
                      {{ shortDate(cycle.cutoffDate) }} cutoff: actual amount received is not logged yet.
                    }
                  </p>
                }
              </div>
              <div class="flex flex-wrap gap-2">
                @if (latestArrived(stream)) {
                  <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-400/40 px-3 py-2 text-sm text-emerald-200" (click)="openReceived(stream)">
                    <svg lucideBanknote [size]="14"></svg> Amount received
                  </button>
                }
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm" (click)="openSalary(stream)">
                  <svg lucidePencil [size]="14"></svg> Update
                </button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/30 px-3 py-2 text-sm text-rose-200" (click)="askRemove('salary', stream.id, stream.name)">
                  <svg lucideTrash2 [size]="14"></svg> Remove
                </button>
              </div>
            </li>
          }
        </ul>
    </section>
    }

    <section class="mt-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold">Owes you</h2>
          <p class="mt-1 text-sm text-slate-400">Their payment is added to your open salary cutoff only after you log it as paid, even if their due day is later.</p>
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
                <p class="font-mono text-emerald-200">{{ remainingOwe(item) | php }} left</p>
              </div>
              @if (item.payments?.at(-1); as lastPaid) {
                <p class="mt-2 text-xs text-sky-100/80">Last paid {{ longDate(lastPaid.date) }} · {{ item.amountReceived | php }} received</p>
              }
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-400/40 px-3 py-2 text-sm text-emerald-200" (click)="openOwePay(item)">
                  <svg lucideCheck [size]="14"></svg> Log paid
                </button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm" (click)="openOwe(item)">
                  <svg lucidePencil [size]="14"></svg> Update
                </button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/30 px-3 py-2 text-sm text-rose-200" (click)="askRemove('owe', item.id, item.name)">
                  <svg lucideTrash2 [size]="14"></svg> Remove
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    @if (budget.otherIncome().length) {
    <section class="mt-6">
      <h2 class="text-lg font-bold">Other income (plan)</h2>
        <ul class="mt-3 space-y-3">
          @for (stream of budget.otherIncome(); track stream.id) {
            <li class="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4">
              <div>
                <p class="font-semibold">{{ stream.name }}</p>
                <p class="text-xs text-slate-400">{{ otherDetail(stream) }} · {{ stream.amount | php }}{{ depositLabel(stream) }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-2 text-sm" (click)="openOther(stream)">
                  <svg lucidePencil [size]="14"></svg> Update
                </button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/30 px-3 py-2 text-sm text-rose-200" (click)="askRemove('other', stream.id, stream.name)">
                  <svg lucideTrash2 [size]="14"></svg> Remove
                </button>
              </div>
            </li>
          }
        </ul>
    </section>
    }

    <app-modal [open]="editing() !== null" (closed)="editing.set(null)">
      @if (editing(); as form) {
        <h2 class="text-xl font-bold">Update {{ form.name || 'income' }}</h2>
        <label class="mt-4 block text-sm">
          Name
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.name" (input)="patchEdit({ name: text($event) })" />
        </label>
        @if (form.kind === 'owe') {
          <label class="mt-3 block text-sm">
            Total debt
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.totalDebt" (input)="patchEdit({ totalDebt: text($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Payment each term
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.amount" (input)="patchEdit({ amount: text($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Terms
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="1" step="1" [value]="form.terms" (input)="patchEdit({ terms: text($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Due day
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="1" max="31" step="1" [value]="form.dueDay" (input)="patchEdit({ dueDay: text($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Date borrowed
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="date" [value]="form.borrowedOn" (input)="patchEdit({ borrowedOn: text($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Remarks
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.remarks" (input)="patchEdit({ remarks: text($event) })" />
          </label>
        } @else {
          <label class="mt-3 block text-sm">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.amount" (input)="patchEdit({ amount: text($event) })" />
          </label>
          @if (form.kind === 'salary') {
            <label class="mt-3 block text-sm">
              Cutoff
              <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.payDay" (change)="patchEdit({ payDay: choice($event) })">
                <option value="10">Every 10th</option>
                <option value="15">Every 15th</option>
                <option value="25">Every 25th</option>
                <option value="30">Every 30th</option>
              </select>
            </label>
          }
          @if (form.months != null) {
            <label class="mt-3 block text-sm">
              Months left
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="1" [value]="form.months" (input)="patchEdit({ months: text($event) })" />
            </label>
          }
          @if (form.specificDate != null) {
            <label class="mt-3 block text-sm">
              Date received
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="date" [value]="form.specificDate" (input)="patchEdit({ specificDate: text($event) })" />
            </label>
          }
          <label class="mt-3 block text-sm">
            Deposited to
            <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" (change)="patchEdit({ accountId: choice($event) })">
              <option value="" [selected]="!form.accountId">Choose bank, e-wallet, or cash</option>
              <option [value]="cashId" [selected]="form.accountId === cashId">Cash on hand · {{ budget.cashOnHand() | php }}</option>
              @for (account of budget.accounts(); track account.id) {
                <option [value]="account.id" [selected]="account.id === form.accountId">{{ budget.accountLabel(account.id) }} · {{ budget.accountBalance(account.id) | php }}</option>
              }
            </select>
          </label>
          <p class="mt-1 text-xs text-slate-500">The latest cutoff that has already arrived, and later ones, are credited to this balance.</p>
        }
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="saveEdit()">Save update</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="editing.set(null)">Cancel</button>
        </div>
      }
    </app-modal>

    <app-modal [open]="received() !== null" (closed)="received.set(null)">
      @if (received(); as form) {
        <h2 class="text-xl font-bold">Amount received · {{ form.stream.name }}</h2>
        <p class="mt-1 text-sm text-slate-400">
          Log the salary that actually came in. The cutoff's remaining money{{ form.stream.accountId ? ' and ' + budget.accountName(form.stream.accountId) + ' balance' : '' }} follow this amount instead of the expected one.
        </p>
        <label class="mt-4 block text-sm">
          Cutoff
          <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" (change)="pickReceivedCycle(choice($event))">
            @for (cycle of form.cycles; track cycle.id) {
              <option [value]="cycle.id" [selected]="cycle.id === form.cycleId">
                {{ longDate(cycle.cutoffDate) }}{{ cycle.actualIncome != null ? ' · logged' : '' }}
              </option>
            }
          </select>
        </label>
        <label class="mt-3 block text-sm">
          Actual amount received
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.amount" (input)="patchReceived(text($event))" />
        </label>
        <p class="mt-1 text-xs text-slate-500">Expected {{ receivedCycle()?.baseIncome ?? 0 | php }}.</p>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="saveReceived()">Save amount</button>
          @if (receivedCycle()?.actualIncome != null) {
            <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="clearReceived()">Use expected</button>
          }
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="received.set(null)">Cancel</button>
        </div>
      }
    </app-modal>

    <app-modal [open]="payingOwe() !== null" (closed)="payingOwe.set(null)">
      @if (payingOwe(); as form) {
        <h2 class="text-xl font-bold">{{ form.item.name }} paid?</h2>
        <p class="mt-1 text-sm text-slate-400">
          This adds to your open salary cutoff on the date they paid. A bill due on the 27th still sees only salary until you log this, even if they are due on the 30th.
        </p>
        <label class="mt-4 block text-sm">
          Amount paid
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.amount" (input)="patchOwePay({ amount: text($event) })" />
        </label>
        <p class="mt-1 text-xs text-slate-500">{{ remainingOwe(form.item) | php }} still owed · {{ form.item.paymentAmount | php }} each term.</p>
        <label class="mt-3 block text-sm">
          Date paid
          <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="date" [value]="form.paidOn" (input)="patchOwePay({ paidOn: text($event) })" />
        </label>
        @if (form.item.payments?.length) {
          <p class="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Payment history</p>
          <ul class="mt-2 space-y-1 text-sm">
            @for (row of oweHistory(form.item); track row.id) {
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                <span>{{ longDate(row.date) }}@if (row.cutoffDate) { · {{ shortDate(row.cutoffDate) }} cutoff }</span>
                <span class="flex items-center gap-2">
                  <span class="font-mono text-emerald-200">{{ row.amount | php }}</span>
                  <button type="button" class="text-xs text-rose-200" (click)="removeOwePay(form.item.id, row.id)">Remove</button>
                </span>
              </li>
            }
          </ul>
        }
        @if (owePayError()) {
          <p class="mt-3 text-sm text-rose-200">{{ owePayError() }}</p>
        }
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="saveOwePay()">Log paid</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="payingOwe.set(null)">Cancel</button>
        </div>
      }
    </app-modal>

    <app-modal [open]="pendingRemove() !== null" (closed)="pendingRemove.set(null)">
      @if (pendingRemove(); as item) {
        <h2 class="text-xl font-bold">Remove {{ item.name }}?</h2>
        <p class="mt-2 text-sm text-slate-400">
          {{ item.kind === 'receipt' ? 'This deposit is removed from the cutoff and from the bank, e-wallet, or cash it was credited to.' : 'Upcoming cutoffs will drop this amount. Payments already logged stay on those cutoffs.' }}
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-2xl bg-rose-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="confirmRemove()">Remove</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="pendingRemove.set(null)">Cancel</button>
        </div>
      }
    </app-modal>
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
  readonly receivedOn = signal(todayIso());
  readonly cycleId = signal('');
  readonly month = signal('all');
  readonly year = signal('all');
  readonly page = signal(1);
  readonly accountId = signal('');
  readonly cashId = CASH_DEPOSIT_ID;
  readonly destKind = signal<'BANK' | 'E_WALLET' | 'CASH'>('BANK');
  readonly destName = signal('');
  readonly destCash = signal('');
  readonly destError = signal('');
  readonly editing = signal<IncomeEdit | null>(null);
  readonly received = signal<ReceivedForm | null>(null);
  readonly payingOwe = signal<{ item: Receivable; amount: string; paidOn: string } | null>(null);
  readonly owePayError = signal('');
  readonly pendingRemove = signal<{ kind: 'salary' | 'other' | 'owe' | 'receipt'; id: string; name: string } | null>(null);
  readonly longDate = formatLongDate;
  readonly shortDate = formatShortDate;

  readonly cutoffOptions = computed(() => {
    const cycles = this.budget.paycheckCycles();
    const byDate = new Map(cycles.map((cycle) => [cycle.cutoffDate, cycle]));
    const years = new Set<number>([Number(todayIso().slice(0, 4))]);
    for (const cycle of cycles) years.add(Number(cycle.cutoffDate.slice(0, 4)));
    const dates = new Set<string>([...byDate.keys(), ...standardSalaryCutoffDates([...years])]);
    return [...dates]
      .sort()
      .map((date) => {
        const cycle = byDate.get(date);
        const inflow = cycle ? this.budget.cycleInflow(cycle) : 0;
        return {
          id: cycle?.id ?? date,
          date,
          year: date.slice(0, 4),
          label: `${formatLongDate(date)} cutoff${inflow > 0 ? ` · ${formatPhp(inflow)} in` : ''}`,
        };
      });
  });

  readonly cutoffGroups = computed(() => {
    const groups: { year: string; rows: CutoffOption[] }[] = [];
    for (const row of this.cutoffOptions()) {
      const current = groups.find((group) => group.year === row.year);
      if (current) current.rows.push(row);
      else groups.push({ year: row.year, rows: [row] });
    }
    return groups;
  });

  readonly selectedCycleId = computed(() => {
    const options = this.cutoffOptions();
    const chosen = this.cycleId();
    if (chosen && options.some((row) => row.id === chosen)) return chosen;
    const today = todayIso();
    return options.find((row) => row.date >= today)?.id ?? options.find((row) => row.date <= today)?.id ?? options.at(-1)?.id ?? '';
  });

  readonly years = computed(() => collectYears(this.budget.incomeReceipts().map((item) => item.receivedOn)));

  readonly filteredReceipts = computed(() =>
    [...this.budget.incomeReceipts()]
      .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.id.localeCompare(a.id))
      .filter((item) => dateInPeriod(item.receivedOn, this.month(), this.year())),
  );

  readonly filteredTotal = computed(() => round2(this.filteredReceipts().reduce((sum, item) => sum + item.amount, 0)));

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredReceipts().length / PAGE_SIZE)));

  readonly pageItems = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.filteredReceipts().slice(start, start + PAGE_SIZE);
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

  readonly receivedCycle = computed(() => {
    const form = this.received();
    return form?.cycles.find((cycle) => cycle.id === form.cycleId) ?? null;
  });

  latestArrived(stream: IncomeStream): PaycheckCycle | undefined {
    return this.budget.arrivedCyclesFor(stream)[0];
  }

  openReceived(stream: IncomeStream): void {
    const cycles = this.budget.arrivedCyclesFor(stream).slice(0, 6);
    const first = cycles[0];
    if (!first) return;
    this.received.set({ stream, cycles, cycleId: first.id, amount: String(this.budget.cycleBaseReceived(first)) });
  }

  pickReceivedCycle(cycleId: string): void {
    const form = this.received();
    const cycle = form?.cycles.find((item) => item.id === cycleId);
    if (!form || !cycle) return;
    this.received.set({ ...form, cycleId, amount: String(this.budget.cycleBaseReceived(cycle)) });
  }

  patchReceived(amount: string): void {
    const form = this.received();
    if (form) this.received.set({ ...form, amount });
  }

  saveReceived(): void {
    const form = this.received();
    const cycle = this.receivedCycle();
    if (!form || !cycle) return;
    const amount = parseMoney(form.amount);
    if (amount < 0 || !Number.isFinite(amount)) {
      this.error.set('Enter the amount you received.');
      return;
    }
    this.budget.setCycleActualIncome(cycle.id, amount);
    this.notice.set(`${form.stream.name} on ${formatLongDate(cycle.cutoffDate)} is logged as ${formatLongDateAmount(amount)} received.`);
    this.received.set(null);
  }

  clearReceived(): void {
    const form = this.received();
    const cycle = this.receivedCycle();
    if (!form || !cycle) return;
    this.budget.setCycleActualIncome(cycle.id, null);
    this.notice.set(`${form.stream.name} on ${formatLongDate(cycle.cutoffDate)} is back to the expected ${formatLongDateAmount(cycle.baseIncome)}.`);
    this.received.set(null);
  }

  isEmpty(): boolean {
    return this.budget.incomeStreams().length === 0 && this.budget.receivables().length === 0 && this.budget.incomeReceipts().length === 0;
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  pickDestKind(event: Event): 'BANK' | 'E_WALLET' | 'CASH' {
    const value = this.choice(event);
    return value === 'E_WALLET' || value === 'CASH' ? value : 'BANK';
  }

  saveDestination(event: Event): void {
    event.preventDefault();
    if (this.destKind() === 'CASH') {
      this.budget.enableCashOnHand(parseMoney(this.destCash()));
      this.accountId.set(CASH_DEPOSIT_ID);
      this.destCash.set('');
      this.destError.set('');
      this.notice.set('Cash on hand is ready. You can add income now.');
      return;
    }
    const name = this.destName().trim();
    if (!name) {
      this.destError.set(this.destKind() === 'E_WALLET' ? 'Enter the e-wallet name.' : 'Enter the bank name.');
      return;
    }
    if (this.budget.accounts().some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      this.destError.set(`${name} is already registered.`);
      return;
    }
    const kind = this.destKind() === 'E_WALLET' ? 'E_WALLET' : 'BANK';
    const account = this.budget.addAccount({ name, kind });
    if (!account) {
      this.destError.set('Could not register that account.');
      return;
    }
    this.accountId.set(account.id);
    this.destName.set('');
    this.destError.set('');
    this.notice.set(`${name} is registered. You can add income now.`);
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
      if (!this.budget.isValidDepositTarget(this.accountId())) {
        this.error.set('Choose the bank, e-wallet, or cash on hand this salary is deposited to.');
        return;
      }
      const receivedOn = this.receivedOn();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
        this.error.set('Enter the date this salary was received.');
        return;
      }
      const cycleId = this.selectedCycleId();
      if (!cycleId) {
        this.error.set('Choose which cutoff this salary belongs to.');
        return;
      }
      const saved = this.budget.addIncomeDeposit({
        name,
        amount,
        kind: 'salary',
        receivedOn,
        cycleId,
        accountId: this.accountId(),
      });
      if (!saved) {
        this.error.set('Choose the cutoff and where this salary was deposited.');
        return;
      }
      this.notice.set(
        `${name} of ${formatLongDateAmount(amount)} was added to the ${formatShortDate(saved.cutoffDate)} cutoff.${saved.credited ? this.depositNotice(receivedOn) : ' It will land in that balance on the received date.'}`,
      );
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
      if (!this.budget.isValidDepositTarget(this.accountId())) {
        this.error.set('Choose the bank, e-wallet, or cash on hand this income was deposited to.');
        return;
      }
      const cycleId = this.selectedCycleId();
      if (!cycleId) {
        this.error.set('Choose which cutoff this income belongs to.');
        return;
      }
      const saved = this.budget.addIncomeDeposit({
        name,
        amount,
        kind: 'other',
        receivedOn,
        cycleId,
        accountId: this.accountId(),
      });
      if (!saved) {
        this.error.set('Choose the cutoff and where this income was deposited.');
        return;
      }
      this.notice.set(
        `${name} of ${formatLongDateAmount(amount)} was added to the ${formatShortDate(saved.cutoffDate)} cutoff.${saved.credited ? this.depositNotice(receivedOn) : ' It will land in that balance on the received date.'}`,
      );
    }
    this.error.set('');
    this.name.set('');
    this.amount.set('');
    this.totalDebt.set('');
    this.terms.set('1');
    this.remarks.set('');
    this.borrowedOn.set('');
    this.receivedOn.set(todayIso());
  }

  ordinal(day: number): string {
    return ordinalDay(day);
  }

  depositLabel(stream: IncomeStream): string {
    const label = this.budget.accountLabel(stream.accountId);
    if (label) return ` · Deposited to ${label}`;
    return this.budget.salaryIncome().some((item) => item.id === stream.id) ? ' · Not linked yet' : '';
  }

  private depositNotice(receivedOn?: string): string {
    const name = this.budget.accountName(this.accountId());
    if (!name) return '';
    if (receivedOn) return receivedOn <= todayIso() ? ` It was credited to ${name}.` : ` It lands in ${name} on ${formatLongDate(receivedOn)}.`;
    return ` The latest cutoff that has arrived was credited to ${name}.`;
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

  openSalary(stream: IncomeStream): void {
    this.editing.set(
      blankEdit('salary', stream.id, stream.name, String(stream.amount), {
        payDay: String(salaryDay(String(stream.dayOfMonth))),
        accountId: stream.accountId ?? '',
      }),
    );
  }

  openOther(stream: IncomeStream): void {
    this.editing.set(
      blankEdit('other', stream.id, stream.name, String(stream.amount), {
        payDay: String(stream.dayOfMonth),
        months: stream.remainingMonths == null ? null : String(stream.remainingMonths),
        specificDate: stream.specificDate ?? (stream.isOneTime ? '' : null),
        accountId: stream.accountId ?? '',
      }),
    );
  }

  remainingOwe(item: Receivable): number {
    return round2(Math.max(0, item.totalDebt - item.amountReceived));
  }

  oweHistory(item: Receivable) {
    return [...(item.payments ?? [])].reverse();
  }

  openOwePay(item: Receivable): void {
    this.owePayError.set('');
    this.payingOwe.set({ item, amount: String(item.paymentAmount), paidOn: todayIso() });
  }

  patchOwePay(partial: Partial<{ amount: string; paidOn: string }>): void {
    const form = this.payingOwe();
    if (form) this.payingOwe.set({ ...form, ...partial });
  }

  saveOwePay(): void {
    const form = this.payingOwe();
    if (!form) return;
    if (parseMoney(form.amount) <= 0) {
      this.owePayError.set('Enter the amount they paid.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.paidOn)) {
      this.owePayError.set('Enter the date they paid.');
      return;
    }
    const message = this.budget.recordReceivablePayment(form.item.id, parseMoney(form.amount), form.paidOn);
    if (!message) {
      this.owePayError.set('Enter a payment that is still owed.');
      return;
    }
    this.notice.set(message);
    this.payingOwe.set(null);
  }

  removeOwePay(receivableId: string, paymentId: string): void {
    this.budget.removeReceivablePayment(receivableId, paymentId);
    const item = this.budget.receivables().find((row) => row.id === receivableId);
    const form = this.payingOwe();
    if (form && item) this.payingOwe.set({ ...form, item });
  }

  openOwe(item: Receivable): void {
    this.editing.set(
      blankEdit('owe', item.id, item.name, String(item.paymentAmount), {
        totalDebt: String(item.totalDebt),
        terms: String(item.terms),
        dueDay: item.dueDayOfMonth ? String(item.dueDayOfMonth) : '',
        borrowedOn: item.borrowedOn ?? '',
        remarks: item.notes ?? '',
      }),
    );
  }

  patchEdit(partial: Partial<IncomeEdit>): void {
    const current = this.editing();
    if (!current) return;
    this.editing.set({ ...current, ...partial });
  }

  saveEdit(): void {
    const form = this.editing();
    if (!form) return;
    const name = form.name.trim();
    const amount = parseMoney(form.amount);
    if (!name) {
      this.error.set('Enter a name.');
      return;
    }
    if (amount <= 0) {
      this.error.set('Enter an amount greater than zero.');
      return;
    }
    if (form.kind === 'salary') {
      if (!this.budget.isValidDepositTarget(form.accountId)) {
        this.error.set('Choose the bank, e-wallet, or cash on hand this salary is deposited to.');
        return;
      }
      const day = salaryDay(form.payDay);
      this.budget.updateIncome(form.id, { name, amount, dayOfMonth: day, cutoffType: salaryCutoffType(day), accountId: form.accountId });
      this.notice.set(`${name} was updated on upcoming cutoffs.`);
    } else if (form.kind === 'owe') {
      const total = parseMoney(form.totalDebt);
      const terms = Number(form.terms);
      const dueDay = Number(form.dueDay);
      if (total <= 0) {
        this.error.set('Enter the total they owe.');
        return;
      }
      if (!Number.isFinite(terms) || terms < 1) {
        this.error.set('Enter how many payment terms they have.');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.borrowedOn)) {
        this.error.set('Enter the date they borrowed the money.');
        return;
      }
      this.budget.updateReceivable(form.id, {
        name,
        totalDebt: total,
        paymentAmount: amount,
        terms,
        dueDayOfMonth: Number.isFinite(dueDay) && dueDay >= 1 ? dueDay : undefined,
        borrowedOn: form.borrowedOn,
        notes: form.remarks.trim(),
      });
      this.notice.set(`${name} was updated.`);
    } else {
      if (!this.budget.isValidDepositTarget(form.accountId)) {
        this.error.set('Choose the bank, e-wallet, or cash on hand this income was deposited to.');
        return;
      }
      const patch: { name: string; amount: number; remainingMonths?: number; specificDate?: string; dayOfMonth?: number; accountId: string } = {
        name,
        amount,
        accountId: form.accountId,
      };
      if (form.months != null) {
        const months = Number(form.months);
        if (!Number.isFinite(months) || months < 0) {
          this.error.set('Enter how many months are left.');
          return;
        }
        patch.remainingMonths = months;
      }
      if (form.specificDate != null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.specificDate)) {
          this.error.set('Enter the date this income is received.');
          return;
        }
        patch.specificDate = form.specificDate;
        patch.dayOfMonth = Number(form.specificDate.slice(8, 10));
      }
      this.budget.updateIncome(form.id, patch);
      this.notice.set(`${name} was updated.`);
    }
    this.error.set('');
    this.editing.set(null);
  }

  askRemove(kind: 'salary' | 'other' | 'owe' | 'receipt', id: string, name: string): void {
    this.pendingRemove.set({ kind, id, name });
  }

  confirmRemove(): void {
    const item = this.pendingRemove();
    if (!item) return;
    if (item.kind === 'receipt') {
      this.budget.removeIncomeReceipt(item.id);
      this.notice.set(`${item.name} was removed from income history.`);
      this.pendingRemove.set(null);
      return;
    }
    if (item.kind === 'owe') {
      const receivable = this.budget.receivables().find((row) => row.id === item.id);
      const inflow = receivable
        ? this.budget.incomeStreams().find((stream) => stream.cutoffType === '30TH_INFLOW' && stream.name.toLowerCase().includes(receivable.name.toLowerCase()))
        : undefined;
      if (inflow) this.budget.removeIncome(inflow.id);
      this.budget.removeReceivable(item.id);
    } else {
      this.budget.removeIncome(item.id);
    }
    this.notice.set(`${item.name} was removed.`);
    this.pendingRemove.set(null);
  }
}

function formatLongDateAmount(amount: number): string {
  return amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });
}

interface CutoffOption {
  id: string;
  date: string;
  year: string;
  label: string;
}

function standardSalaryCutoffDates(years: number[]): string[] {
  const dates: string[] = [];
  for (const year of years.sort((a, b) => a - b)) {
    for (let month = 1; month <= 12; month++) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      for (const day of [10, 15, 25, 30]) dates.push(shiftMonth(start, 0, day));
    }
  }
  return dates;
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

interface ReceivedForm {
  stream: IncomeStream;
  cycles: PaycheckCycle[];
  cycleId: string;
  amount: string;
}

interface IncomeEdit {
  kind: 'salary' | 'other' | 'owe';
  id: string;
  name: string;
  amount: string;
  payDay: string;
  months: string | null;
  specificDate: string | null;
  totalDebt: string;
  terms: string;
  dueDay: string;
  borrowedOn: string;
  remarks: string;
  accountId: string;
}

function blankEdit(kind: IncomeEdit['kind'], id: string, name: string, amount: string, extra: Partial<IncomeEdit> = {}): IncomeEdit {
  return {
    kind,
    id,
    name,
    amount,
    payDay: '10',
    months: null,
    specificDate: null,
    totalDebt: '',
    terms: '1',
    dueDay: '',
    borrowedOn: '',
    remarks: '',
    accountId: '',
    ...extra,
  };
}
