import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  LucideHandCoins,
  LucidePencil,
  LucidePlus,
  LucideTrash2,
  LucideX,
} from '@lucide/angular';
import { CATEGORY_FILTERS, CATEGORY_META, STATUS_META, categoryLabel, cutoffLabel, defaultCutoff } from '../../core/categories';
import { todayIso } from '../../core/dates';
import { collectYears, rangeOverlapsPeriod } from '../../core/period';
import { parseMoney, round2 } from '../../core/money';
import { AssignedCutoff, ItemStatus, LiabilityCategory, LiabilityItem } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PeriodFilterComponent } from '../../shared/period-filter.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

interface EditorState {
  mode: 'add' | 'edit' | 'pay';
  id?: string;
  name: string;
  bankName: string;
  category: LiabilityCategory;
  totalBalance: string;
  monthlyAmortization: string;
  minimumDue: string;
  dueDay: string;
  cutoff: AssignedCutoff;
  terms: string;
  startDate: string;
  endDate: string;
  status: ItemStatus;
  notes: string;
  addToCycles: boolean;
  payment: string;
  paymentNote: string;
}

type EditorField = 'bankName' | 'status' | 'balance' | 'monthly' | 'minimum' | 'terms' | 'startDate' | 'endDate';

/** Fields each bill type needs when adding. Edit mode also shows balance and status for debts. */
const ADD_FIELDS: Record<LiabilityCategory, EditorField[]> = {
  FIXED_LOAN: ['bankName', 'monthly', 'terms', 'startDate'],
  REVOLVING_CC: ['bankName', 'balance', 'minimum', 'monthly'],
  ONE_TIME_OLA: ['bankName', 'balance'],
  PAST_DUE_OLA: ['bankName', 'balance', 'monthly'],
  PERSONAL_DEBT: ['balance', 'monthly', 'terms', 'startDate'],
  LIVING_EXPENSE: ['monthly', 'startDate', 'endDate'],
};

const CATEGORY_HINTS: Record<LiabilityCategory, string> = {
  FIXED_LOAN: 'Same amount every month. The balance is the monthly amount times the months to pay.',
  REVOLVING_CC: 'Card balance with a minimum due. The planned payment goes on each cutoff.',
  ONE_TIME_OLA: 'Paid once in full on the next matching cutoff.',
  PAST_DUE_OLA: 'Overdue balance you are paying down. The monthly amount is what you plan to pay each cutoff.',
  PERSONAL_DEBT: 'Money you owe a person. Terms are optional.',
  LIVING_EXPENSE: 'Recurring household cost. It repeats on every matching cutoff.',
};

@Component({
  selector: 'app-debt-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhpPipe, PeriodFilterComponent, ModalComponent, WarningPopupComponent, LucidePlus, LucidePencil, LucideTrash2, LucideHandCoins, LucideX],
  template: `
    <section class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm text-slate-400">Loans, cards, OLAs, and living costs</p>
        <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Debts / Expenses</h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-400">
          Balances update when you mark a cutoff paid. You can also correct a balance or log an extra payment.
        </p>
      </div>
      <button type="button" class="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950" (click)="openAdd()">
        <svg lucidePlus [size]="16"></svg> Add bill
      </button>
    </section>

    @if (notice()) {
      <p class="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{{ notice() }}</p>
    }

    <div class="mt-5 flex flex-wrap items-end justify-between gap-3">
      <app-period-filter [(month)]="month" [(year)]="year" [years]="years()" />
      <label class="text-xs text-slate-400">
        Type
        <select class="mt-1 block min-w-44 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="category()" (change)="onType($event)">
          @for (filter of filters; track filter) {
            <option [value]="filter">{{ categoryLabel(filter) }} ({{ countFor(filter) }})</option>
          }
        </select>
      </label>
    </div>

    <label class="mt-4 block">
      <span class="sr-only">Search bills</span>
      <input
        class="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm outline-none ring-emerald-300/40 focus:ring-2"
        type="search"
        placeholder="Search by name or note"
        [value]="query()"
        (input)="query.set(inputValue($event))"
      />
    </label>

    <p class="mt-4 text-sm text-slate-400">
      Showing {{ filtered().length }} · debt balance {{ filteredBalance() | php }}
    </p>

    <div class="mt-3 space-y-3">
      @for (item of filtered(); track item.id) {
        <article class="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="font-semibold">{{ item.name }}</h2>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset" [class]="categoryMeta[item.category].badgeClass">
                  {{ categoryMeta[item.category].label }}
                </span>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset" [class]="statusMeta[item.status].badgeClass">
                  {{ statusMeta[item.status].label }}
                </span>
              </div>
              @if (item.notes) {
                <p class="mt-2 max-w-3xl text-sm text-slate-400">{{ item.notes }}</p>
              }
            </div>
            <p class="font-mono text-lg">{{ item.category === 'LIVING_EXPENSE' ? (item.monthlyAmortization | php) : (item.totalBalance | php) }}</p>
          </div>
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div>
              <dt class="text-xs text-slate-500">Bank / OLA</dt>
              <dd>{{ item.bankName || item.name }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Due day</dt>
              <dd>{{ item.dueDayOfMonth }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Cutoff</dt>
              <dd>{{ item.splitAcrossCutoffs ? '10th & 25th' : cutoffLabel(item.assignedCutoff) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Monthly</dt>
              <dd class="font-mono">{{ item.monthlyAmortization > 0 ? (item.monthlyAmortization | php) : '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Terms left</dt>
              <dd>{{ item.remainingTerms ?? '—' }}</dd>
            </div>
          </dl>
          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" class="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm" (click)="openEdit(item)">
              <svg lucidePencil [size]="14"></svg> Edit balance
            </button>
            @if (item.category !== 'LIVING_EXPENSE' && item.status !== 'PAID') {
              <button type="button" class="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm" (click)="openPay(item)">
                <svg lucideHandCoins [size]="14"></svg> Log payment
              </button>
            }
            <button type="button" class="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 px-3 py-1.5 text-sm text-rose-200" (click)="pendingDelete.set(item)">
              <svg lucideTrash2 [size]="14"></svg> Remove
            </button>
          </div>
        </article>
      } @empty {
        <p class="rounded-3xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-slate-400">No bills match this filter.</p>
      }
    </div>

    <app-modal [open]="editor() !== null" (closed)="editor.set(null)">
      @if (editor(); as form) {
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-xl font-bold">
            {{ form.mode === 'add' ? 'Add a bill' : form.mode === 'pay' ? 'Log a payment' : 'Edit ' + form.name }}
          </h2>
          <button type="button" class="grid h-9 w-9 place-items-center rounded-full border border-white/10" (click)="editor.set(null)" aria-label="Close">
            <svg lucideX [size]="16"></svg>
          </button>
        </div>

        @if (form.mode === 'pay') {
          <p class="mt-2 text-sm text-slate-400">
            This reduces the balance now. If the same bill is still on a cutoff, lower that planned amount so it is not counted twice.
          </p>
          <label class="mt-4 block text-sm">
            Amount
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.payment" (input)="patch({ payment: inputValue($event) })" />
          </label>
          <label class="mt-3 block text-sm">
            Note
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.paymentNote" placeholder="Extra principal, amnesty, discount" (input)="patch({ paymentNote: inputValue($event) })" />
          </label>
          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" class="rounded-full border border-white/15 px-3 py-1.5 text-sm" (click)="fillFullBalance()">Settle full balance</button>
            <button type="button" class="rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="savePayment()">Save payment</button>
          </div>
        } @else {
          <p class="mt-2 text-sm text-slate-400">{{ categoryHint(form.category) }}</p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="block text-sm sm:col-span-2">
              Name
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.name" (input)="patch({ name: inputValue($event) })" />
            </label>
            <label class="block text-sm">
              Category
              <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.category" (change)="onCategory($event)">
                @for (option of categories; track option) {
                  <option [value]="option">{{ categoryLabel(option) }}</option>
                }
              </select>
            </label>
            @if (shows(form, 'bankName')) {
              <label class="block text-sm">
                Expense Name
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.bankName" placeholder="Bank, card, or app" (input)="patch({ bankName: inputValue($event) })" />
              </label>
            }
            @if (shows(form, 'status')) {
              <label class="block text-sm">
                Status
                <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.status" (change)="onStatus($event)">
                  <option value="ACTIVE">Active</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="PAST_DUE">Past due</option>
                  <option value="PAID">Paid</option>
                </select>
              </label>
            }
            @if (shows(form, 'balance')) {
              <label class="block text-sm">
                {{ form.category === 'ONE_TIME_OLA' ? 'Amount to pay' : 'Balance' }}
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.totalBalance" (input)="patch({ totalBalance: inputValue($event) })" />
              </label>
            }
            @if (shows(form, 'monthly')) {
              <label class="block text-sm">
                {{ monthlyLabel(form.category) }}
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.monthlyAmortization" (input)="patch({ monthlyAmortization: inputValue($event) })" />
              </label>
            }
            @if (shows(form, 'minimum')) {
              <label class="block text-sm">
                Minimum due
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="0.01" [value]="form.minimumDue" (input)="patch({ minimumDue: inputValue($event) })" />
              </label>
            }
            @if (shows(form, 'terms')) {
              <label class="block text-sm">
                {{ form.category === 'FIXED_LOAN' ? 'Months to pay' : 'Terms left' }}
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono" type="number" min="0" step="1" [value]="form.terms" (input)="patch({ terms: inputValue($event) })" />
              </label>
            }
            <label class="block text-sm">
              Due day
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="number" min="1" max="31" [value]="form.dueDay" (input)="onDueDay($event)" />
            </label>
            <label class="block text-sm">
              Assigned cutoff
              <select class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [value]="form.cutoff" (change)="onCutoff($event)">
                <option value="10TH_CUTOFF">10th cutoff</option>
                <option value="15TH_CUTOFF">15th cutoff</option>
                <option value="25TH_CUTOFF">25th cutoff</option>
                <option value="30TH_CUTOFF">30th cutoff</option>
                <option value="BOTH">10th and 25th</option>
              </select>
            </label>
            @if (shows(form, 'startDate')) {
              <label class="block text-sm">
                {{ form.category === 'FIXED_LOAN' ? 'First payment month' : 'Start date' }}
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="date" [value]="form.startDate" (input)="patch({ startDate: inputValue($event) })" />
              </label>
            }
            @if (shows(form, 'endDate')) {
              <label class="block text-sm">
                End date
                <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="date" [value]="form.endDate" (input)="patch({ endDate: inputValue($event) })" />
              </label>
            }
            <label class="block text-sm sm:col-span-2">
              Notes
              <textarea class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" rows="2" [value]="form.notes" (input)="patch({ notes: inputValue($event) })"></textarea>
            </label>
          </div>
          @if (form.mode === 'add' && form.category === 'FIXED_LOAN' && loanTotal(form) > 0) {
            <p class="mt-3 text-sm text-slate-400">
              Total to pay: <span class="font-mono text-white">{{ loanTotal(form) | php }}</span>
              ({{ loanMonthly(form) | php }} × {{ form.terms }} months)
            </p>
          }
          @if (form.mode === 'add') {
            <label class="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" [checked]="form.addToCycles" (change)="patch({ addToCycles: checkedValue($event) })" />
              Add this amount to future matching cutoffs
            </label>
          }
          <button type="button" class="mt-4 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950" (click)="saveEditor()">
            {{ form.mode === 'add' ? 'Add bill' : 'Save changes' }}
          </button>
        }
      }
    </app-modal>

    <app-modal [open]="pendingDelete() !== null" (closed)="pendingDelete.set(null)">
      @if (pendingDelete(); as item) {
        <h2 class="text-xl font-bold">Remove {{ item.name }}?</h2>
        <p class="mt-2 text-sm text-slate-400">Unpaid rows on future cutoffs are removed. Payments you already checked stay on those cutoffs as history.</p>
        <div class="mt-5 flex gap-2">
          <button type="button" class="rounded-2xl bg-rose-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="confirmDelete()">Remove</button>
          <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="pendingDelete.set(null)">Cancel</button>
        </div>
      }
    </app-modal>

    <app-warning [message]="formError()" (closed)="formError.set('')" />
  `,
})
export class DebtInventoryComponent {
  readonly budget = inject(BudgetStateService);
  readonly filters = CATEGORY_FILTERS;
  readonly categories = CATEGORY_FILTERS.filter((item): item is LiabilityCategory => item !== 'ALL');
  readonly categoryMeta = CATEGORY_META;
  readonly statusMeta = STATUS_META;
  readonly categoryLabel = categoryLabel;
  readonly cutoffLabel = cutoffLabel;
  readonly category = signal<(typeof CATEGORY_FILTERS)[number]>('ALL');
  readonly month = signal('all');
  readonly year = signal('all');
  readonly query = signal('');
  readonly editor = signal<EditorState | null>(null);
  readonly formError = signal('');
  readonly pendingDelete = signal<LiabilityItem | null>(null);
  readonly notice = signal('');

  readonly years = computed(() => collectYears([], this.budget.liabilities().map((item) => ({ start: item.startDate, end: item.endDate }))));

  readonly inPeriod = computed(() =>
    this.budget.liabilities().filter((item) => rangeOverlapsPeriod(item.startDate, item.endDate, this.month(), this.year())),
  );

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const category = this.category();
    return this.inPeriod()
      .filter((item) => category === 'ALL' || item.category === category)
      .filter((item) => !q || item.name.toLowerCase().includes(q) || (item.notes ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.priorityRank - b.priorityRank || a.name.localeCompare(b.name));
  });

  readonly filteredBalance = computed(() =>
    round2(
      this.filtered()
        .filter((item) => item.category !== 'LIVING_EXPENSE')
        .reduce((sum, item) => sum + item.totalBalance, 0),
    ),
  );

  countFor(filter: (typeof CATEGORY_FILTERS)[number]): number {
    const items = this.inPeriod();
    if (filter === 'ALL') return items.length;
    return items.filter((item) => item.category === filter).length;
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  onType(event: Event): void {
    this.category.set(this.selectValue(event) as (typeof CATEGORY_FILTERS)[number]);
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  checkedValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  openAdd(): void {
    this.formError.set('');
    this.editor.set({
      mode: 'add',
      name: '',
      bankName: '',
      category: 'FIXED_LOAN',
      totalBalance: '',
      monthlyAmortization: '',
      minimumDue: '',
      dueDay: '15',
      cutoff: '10TH_CUTOFF',
      terms: '',
      startDate: todayIso(),
      endDate: '',
      status: 'ACTIVE',
      notes: '',
      addToCycles: true,
      payment: '',
      paymentNote: '',
    });
  }

  openEdit(item: LiabilityItem): void {
    this.formError.set('');
    this.editor.set(this.fromItem(item, 'edit'));
  }

  openPay(item: LiabilityItem): void {
    this.formError.set('');
    this.editor.set({ ...this.fromItem(item, 'pay'), payment: '', paymentNote: '' });
  }

  patch(partial: Partial<EditorState>): void {
    const current = this.editor();
    if (!current) return;
    this.editor.set({ ...current, ...partial });
  }

  onCategory(event: Event): void {
    const category = this.selectValue(event) as LiabilityCategory;
    const current = this.editor();
    const status: ItemStatus = current?.mode === 'add' ? (category === 'PAST_DUE_OLA' ? 'PAST_DUE' : 'ACTIVE') : (current?.status ?? 'ACTIVE');
    this.patch({ category, status });
  }

  shows(form: EditorState, field: EditorField): boolean {
    if (ADD_FIELDS[form.category].includes(field)) return true;
    if (form.mode !== 'edit' || form.category === 'LIVING_EXPENSE') return false;
    return field === 'balance' || field === 'status';
  }

  categoryHint(category: LiabilityCategory): string {
    return CATEGORY_HINTS[category];
  }

  monthlyLabel(category: LiabilityCategory): string {
    if (category === 'REVOLVING_CC' || category === 'PAST_DUE_OLA') return 'Planned payment per cutoff';
    if (category === 'FIXED_LOAN') return 'Monthly amount';
    return 'Amount per cutoff';
  }

  loanMonthly(form: EditorState): number {
    return parseMoney(form.monthlyAmortization);
  }

  loanTotal(form: EditorState): number {
    const monthly = parseMoney(form.monthlyAmortization);
    const terms = Number(form.terms);
    if (monthly <= 0 || !Number.isInteger(terms) || terms < 1) return 0;
    return round2(monthly * terms);
  }

  onStatus(event: Event): void {
    this.patch({ status: this.selectValue(event) as ItemStatus });
  }

  onCutoff(event: Event): void {
    this.patch({ cutoff: this.selectValue(event) as AssignedCutoff });
  }

  onDueDay(event: Event): void {
    const dueDay = this.inputValue(event);
    const day = Number(dueDay);
    this.patch({
      dueDay,
      cutoff: defaultCutoff(Number.isFinite(day) ? day : 1),
    });
  }

  fillFullBalance(): void {
    const form = this.editor();
    if (!form) return;
    this.patch({ payment: form.totalBalance, paymentNote: form.paymentNote || 'Settlement / amnesty' });
  }

  savePayment(): void {
    const form = this.editor();
    if (!form?.id) return;
    const amount = parseMoney(form.payment);
    if (amount <= 0) {
      this.formError.set('Enter a payment amount.');
      return;
    }
    this.budget.logAdHocPayment(form.id, amount, form.paymentNote);
    this.notice.set(`Payment for ${form.name} was saved.`);
    this.editor.set(null);
  }

  saveEditor(): void {
    const form = this.editor();
    if (!form) return;
    if (!form.name.trim()) {
      this.formError.set('Give the bill a name.');
      return;
    }
    const dueDay = Number(form.dueDay);
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
      this.formError.set('Due day must be between 1 and 31.');
      return;
    }
    const adding = form.mode === 'add';
    const category = form.category;
    let totalBalance = this.shows(form, 'balance') ? parseMoney(form.totalBalance) : 0;
    let monthlyAmortization = this.shows(form, 'monthly') ? parseMoney(form.monthlyAmortization) : 0;
    const minimumDue = this.shows(form, 'minimum') && form.minimumDue ? parseMoney(form.minimumDue) : undefined;
    let remainingTerms = this.shows(form, 'terms') && form.terms ? Number(form.terms) : undefined;

    if (category === 'FIXED_LOAN') {
      if (monthlyAmortization <= 0) return this.formError.set('Enter the monthly amount.');
      if (!remainingTerms || remainingTerms < 1) return this.formError.set('Enter how many months are left.');
      if (adding) totalBalance = round2(monthlyAmortization * remainingTerms);
    } else if (category === 'LIVING_EXPENSE') {
      if (monthlyAmortization <= 0) return this.formError.set('Enter the amount per cutoff.');
    } else if (category === 'ONE_TIME_OLA') {
      if (totalBalance <= 0) return this.formError.set('Enter the amount to pay.');
      monthlyAmortization = totalBalance;
      remainingTerms = 1;
    } else if (category === 'REVOLVING_CC') {
      if (totalBalance <= 0) return this.formError.set('Enter the card balance.');
      if (monthlyAmortization <= 0) monthlyAmortization = minimumDue ?? 0;
      if (monthlyAmortization <= 0) return this.formError.set('Enter a planned payment or a minimum due.');
    } else if (totalBalance <= 0) {
      return this.formError.set('Enter the balance.');
    }
    if (monthlyAmortization > totalBalance && category !== 'LIVING_EXPENSE' && category !== 'FIXED_LOAN') {
      monthlyAmortization = totalBalance;
    }

    const draft = {
      name: form.name,
      bankName: this.shows(form, 'bankName') || !adding ? form.bankName : '',
      category,
      totalBalance,
      monthlyAmortization,
      minimumDue,
      dueDayOfMonth: dueDay,
      assignedCutoff: form.cutoff,
      remainingTerms,
      startDate: this.shows(form, 'startDate') ? form.startDate : adding ? todayIso() : form.startDate,
      endDate: this.shows(form, 'endDate') || !adding ? form.endDate : '',
      status: form.status,
      notes: form.notes,
      addToFutureCutoffs: form.addToCycles,
    };
    const savedName = form.name.trim();
    if (form.mode === 'add') {
      this.budget.addLiability(draft);
      this.notice.set(`${savedName} was added.`);
    } else if (form.id) {
      this.budget.updateLiability(form.id, draft);
      this.notice.set(`${savedName} was updated.`);
    }
    this.editor.set(null);
  }

  confirmDelete(): void {
    const item = this.pendingDelete();
    if (!item) return;
    this.budget.deleteLiability(item.id);
    this.notice.set(`${item.name} was removed.`);
    this.pendingDelete.set(null);
  }

  private fromItem(item: LiabilityItem, mode: EditorState['mode']): EditorState {
    return {
      mode,
      id: item.id,
      name: item.name,
      bankName: item.bankName ?? '',
      category: item.category,
      totalBalance: String(item.totalBalance),
      monthlyAmortization: String(item.monthlyAmortization || ''),
      minimumDue: item.minimumDue ? String(item.minimumDue) : '',
      dueDay: String(item.dueDayOfMonth),
      cutoff: item.assignedCutoff,
      terms: item.remainingTerms != null ? String(item.remainingTerms) : '',
      startDate: item.startDate,
      endDate: item.endDate ?? '',
      status: item.status,
      notes: item.notes ?? '',
      addToCycles: false,
      payment: '',
      paymentNote: '',
    };
  }
}
