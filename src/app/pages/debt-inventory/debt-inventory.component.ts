import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucidePencil, LucidePlus, LucideTrash2, LucideX } from '@lucide/angular';
import { CATEGORY_FILTERS, CATEGORY_META, categoryLabel, cutoffDays, cutoffLabel, isPairCutoff } from '../../core/categories';
import { formatLongDate, todayIso } from '../../core/dates';
import { parseMoney, round2 } from '../../core/money';
import { MONTH_OPTIONS, collectYears, rangeOverlapsPeriod } from '../../core/period';
import { AssignedCutoff, ItemStatus, LiabilityCategory, LiabilityItem } from '../../models/budget.model';
import { BudgetStateService } from '../../services/budget-state.service';
import { ModalComponent } from '../../shared/modal.component';
import { PhpPipe } from '../../shared/php.pipe';
import { WarningPopupComponent } from '../../shared/warning-popup.component';

interface EditorState {
  mode: 'add' | 'edit';
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
}

type EditorField = 'bankName' | 'status' | 'balance' | 'monthly' | 'minimum' | 'terms' | 'startDate' | 'endDate';

const ADD_FIELDS: Record<LiabilityCategory, EditorField[]> = {
  FIXED_LOAN: ['bankName', 'monthly', 'terms', 'startDate'],
  REVOLVING_CC: ['bankName', 'balance', 'minimum', 'monthly'],
  ONE_TIME_OLA: ['bankName', 'balance'],
  PAST_DUE_OLA: ['bankName', 'balance', 'monthly'],
  PERSONAL_DEBT: ['balance', 'monthly', 'terms', 'startDate'],
  LIVING_EXPENSE: ['monthly', 'startDate', 'endDate'],
};

const FILTER_CHIPS: { id: (typeof CATEGORY_FILTERS)[number]; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'FIXED_LOAN', label: 'Loan' },
  { id: 'REVOLVING_CC', label: 'Card' },
  { id: 'ONE_TIME_OLA', label: 'OLA' },
  { id: 'PAST_DUE_OLA', label: 'Past due' },
  { id: 'PERSONAL_DEBT', label: 'Personal' },
  { id: 'LIVING_EXPENSE', label: 'Living' },
];

const CATEGORY_HINTS: Record<LiabilityCategory, string> = {
  FIXED_LOAN: 'Same amount every month. Pick 10th and 25th to split that amount across both paydays.',
  REVOLVING_CC: 'Card balance with a minimum due. The planned payment goes on each matching cutoff.',
  ONE_TIME_OLA: 'Paid once. A cutoff pair splits that amount across those two paydays.',
  PAST_DUE_OLA: 'Overdue balance. The monthly amount is what you plan to pay each cutoff.',
  PERSONAL_DEBT: 'Money you owe a person. Terms are optional.',
  LIVING_EXPENSE: 'Recurring household cost. A cutoff pair splits the amount across those paydays.',
};

@Component({
  selector: 'app-debt-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, PhpPipe, ModalComponent, WarningPopupComponent, LucidePlus, LucidePencil, LucideTrash2, LucideX],
  template: `
    <section class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm text-slate-400">Loans, cards, OLAs, and living costs</p>
        <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Debts / Expenses</h1>
      </div>
      <button type="button" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 sm:w-auto" (click)="openAdd()">
        <svg lucidePlus [size]="16"></svg> Add bill
      </button>
    </section>

    @if (notice()) {
      <p class="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{{ notice() }}</p>
    }

    <div class="mt-5 -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
      <select class="h-10 shrink-0 rounded-full border border-white/10 bg-slate-950 px-3 text-sm text-white" [value]="month()" (change)="month.set(selectValue($event))" aria-label="Month">
        <option value="all">Any month</option>
        @for (item of months; track item.value) {
          <option [value]="item.value">{{ item.short }}</option>
        }
      </select>
      <select class="h-10 shrink-0 rounded-full border border-white/10 bg-slate-950 px-3 text-sm text-white" [value]="year()" (change)="year.set(selectValue($event))" aria-label="Year">
        <option value="all">Any year</option>
        @for (item of years(); track item) {
          <option [value]="item">{{ item }}</option>
        }
      </select>
      @for (chip of chips; track chip.id) {
        <button
          type="button"
          class="h-10 shrink-0 rounded-full border px-3 text-sm"
          [ngClass]="category() === chip.id ? 'border-emerald-300 bg-emerald-400 font-semibold text-slate-950' : 'border-white/10 bg-white/5'"
          (click)="category.set(chip.id)"
        >
          {{ chip.label }}
          <span class="opacity-70">{{ countFor(chip.id) }}</span>
        </button>
      }
    </div>

    <label class="mt-3 block">
      <span class="sr-only">Search bills</span>
      <input
        class="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm outline-none ring-emerald-300/40 focus:ring-2"
        type="search"
        placeholder="Search name or note"
        [value]="query()"
        (input)="query.set(inputValue($event))"
      />
    </label>

    <p class="mt-3 text-sm text-slate-400">
      {{ filtered().length }} {{ filtered().length === 1 ? 'bill' : 'bills' }} · {{ filteredBalance() | php }}
    </p>

    <div class="mt-3 space-y-2">
      @for (item of filtered(); track item.id) {
        <article class="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate font-semibold">{{ item.name }}</h2>
              <p class="mt-0.5 text-xs text-slate-400">
                {{ categoryMeta[item.category].label }}
                · {{ cutoffLabel(item.assignedCutoff) }}
                @if (!isPair(item.assignedCutoff)) {
                  · due {{ item.dueDayOfMonth }}
                }
              </p>
            </div>
            <p class="shrink-0 font-mono text-base font-semibold">
              {{ item.category === 'LIVING_EXPENSE' ? (item.monthlyAmortization | php) : (item.totalBalance | php) }}
            </p>
          </div>
          @if (item.splitAcrossCutoffs || isPair(item.assignedCutoff)) {
            <p class="mt-2 text-xs text-emerald-200">{{ splitHint(item) }}</p>
          }
          <div class="mt-3 flex gap-2">
            <button type="button" class="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-white/15 py-2 text-xs sm:text-sm" (click)="openEdit(item)">
              <svg lucidePencil [size]="14"></svg> Edit
            </button>
            <button type="button" class="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-400/30 px-3 py-2 text-xs text-rose-200 sm:text-sm" (click)="pendingDelete.set(item)">
              <svg lucideTrash2 [size]="14"></svg> Remove
            </button>
          </div>
        </article>
      } @empty {
        <p class="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">No bills match this filter.</p>
      }
    </div>

    <app-modal [open]="editor() !== null" align="center" (closed)="editor.set(null)">
      @if (editor(); as form) {
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-left text-xl font-bold">
            {{ form.mode === 'add' ? 'Add a bill' : 'Edit ' + form.name }}
          </h2>
          <button type="button" class="grid h-9 w-9 place-items-center rounded-full border border-white/10" (click)="editor.set(null)" aria-label="Close">
            <svg lucideX [size]="16"></svg>
          </button>
        </div>

        <p class="mt-2 text-left text-sm text-slate-400">{{ categoryHint(form.category) }}</p>
        <div class="mt-4 grid gap-3 text-left">
          <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
            <span>Name *</span>
            <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" [value]="form.name" [placeholder]="namePlaceholder(form.category)" (input)="patch({ name: inputValue($event) })" />
          </label>
          <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
            <span>Type *</span>
            <select class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" [value]="form.category" (change)="onCategory($event)">
              @for (option of categories; track option) {
                <option [value]="option">{{ categoryLabel(option) }}</option>
              }
            </select>
          </label>
          @if (shows(form, 'bankName')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>Lender / app</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" [value]="form.bankName" placeholder="BPI, GCash, SSS" (input)="patch({ bankName: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'status')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>Status</span>
              <select class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" [value]="form.status" (change)="onStatus($event)">
                <option value="ACTIVE">Active</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="PAST_DUE">Past due</option>
                <option value="PAID">Paid</option>
              </select>
            </label>
          }
          @if (shows(form, 'balance')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>{{ form.category === 'ONE_TIME_OLA' ? 'Amount *' : 'Balance *' }}</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left font-mono" type="number" min="0" step="0.01" [value]="form.totalBalance" (input)="patch({ totalBalance: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'monthly')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>{{ monthlyLabel(form.category) }} *</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left font-mono" type="number" min="0" step="0.01" [value]="form.monthlyAmortization" (input)="patch({ monthlyAmortization: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'minimum')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>Minimum due</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left font-mono" type="number" min="0" step="0.01" [value]="form.minimumDue" (input)="patch({ minimumDue: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'terms')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>{{ form.category === 'FIXED_LOAN' ? 'Months *' : 'Terms left' }}</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left font-mono" type="number" min="0" step="1" [value]="form.terms" (input)="patch({ terms: inputValue($event) })" />
            </label>
          }
          <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
            <span>Pay from *</span>
            <select class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" [value]="form.cutoff" (change)="onCutoff($event)">
              <optgroup label="10th and 25th">
                <option value="10TH_CUTOFF">10th only</option>
                <option value="25TH_CUTOFF">25th only</option>
                <option value="BOTH">10th and 25th · split amount</option>
              </optgroup>
              <optgroup label="15th and 30th">
                <option value="15TH_CUTOFF">15th only</option>
                <option value="30TH_CUTOFF">30th only</option>
                <option value="15_30">15th and 30th · split amount</option>
              </optgroup>
            </select>
          </label>
          @if (isPair(form.cutoff)) {
            <p class="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-left text-sm text-emerald-100">
              {{ splitPreview(form) }}
            </p>
          } @else {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>Due day *</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" type="number" min="1" max="31" [value]="form.dueDay" (input)="patch({ dueDay: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'startDate')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>{{ form.category === 'FIXED_LOAN' ? 'First month' : 'Start date' }}</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" type="date" [value]="form.startDate" (input)="patch({ startDate: inputValue($event) })" />
            </label>
          }
          @if (shows(form, 'endDate')) {
            <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span>End date</span>
              <input class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" type="date" [value]="form.endDate" (input)="patch({ endDate: inputValue($event) })" />
            </label>
          }
          <label class="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 text-sm">
            <span class="pt-2">Notes</span>
            <textarea class="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-left" rows="2" [value]="form.notes" (input)="patch({ notes: inputValue($event) })"></textarea>
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
              Also add to later matching cutoffs
            </label>
          }
          <button type="button" class="mt-4 w-full rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950" (click)="saveEditor()">
            {{ form.mode === 'add' ? 'Add bill' : 'Save changes' }}
          </button>
      }
    </app-modal>

    <app-modal [open]="pendingDelete() !== null" align="center" (closed)="pendingDelete.set(null)">
      @if (pendingDelete(); as item) {
        <h2 class="text-xl font-bold">Remove {{ item.name }}?</h2>
        <p class="mt-2 text-sm text-slate-400">Unpaid rows on future cutoffs are removed. Payments you already checked stay as history.</p>
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
  readonly chips = FILTER_CHIPS;
  readonly categories = CATEGORY_FILTERS.filter((item): item is LiabilityCategory => item !== 'ALL');
  readonly months = MONTH_OPTIONS.map((item) => ({ ...item, short: item.label.slice(0, 3) }));
  readonly categoryMeta = CATEGORY_META;
  readonly categoryLabel = categoryLabel;
  readonly cutoffLabel = cutoffLabel;
  readonly isPair = isPairCutoff;
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

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  checkedValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  namePlaceholder(category: LiabilityCategory): string {
    if (category === 'FIXED_LOAN') return 'Housing loan, car loan';
    if (category === 'LIVING_EXPENSE') return 'Rent, Meralco, internet';
    if (category === 'REVOLVING_CC') return 'BPI Mastercard';
    return 'Bill name';
  }

  splitHint(item: LiabilityItem): string {
    const parts = cutoffDays(item.assignedCutoff);
    const amount = item.monthlyAmortization > 0 ? item.monthlyAmortization : item.totalBalance;
    const share = round2(amount / Math.max(1, parts.length));
    return `${share.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })} on each ${cutoffLabel(item.assignedCutoff)} cutoff`;
  }

  splitPreview(form: EditorState): string {
    const parts = cutoffDays(form.cutoff);
    const amount = this.splitBase(form);
    if (amount <= 0) return `Amount is split across the ${cutoffLabel(form.cutoff)}. Each slice is due on that cutoff date.`;
    const share = round2(amount / parts.length);
    const last = round2(amount - share * (parts.length - 1));
    const labels = parts.map((day, index) => `${day}${this.ordinal(day)}: ${(index === parts.length - 1 ? last : share).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}`);
    return `Split ${labels.join(' · ')}. Due date follows each cutoff.`;
  }

  private splitBase(form: EditorState): number {
    if (this.shows(form, 'monthly')) return parseMoney(form.monthlyAmortization);
    return parseMoney(form.totalBalance);
  }

  private ordinal(day: number): string {
    if (day === 11 || day === 12 || day === 13) return 'th';
    const last = day % 10;
    if (last === 1) return 'st';
    if (last === 2) return 'nd';
    if (last === 3) return 'rd';
    return 'th';
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
      dueDay: '25',
      cutoff: '25TH_CUTOFF',
      terms: '',
      startDate: todayIso(),
      endDate: '',
      status: 'ACTIVE',
      notes: '',
      addToCycles: true,
    });
  }

  openEdit(item: LiabilityItem): void {
    this.formError.set('');
    this.editor.set(this.fromItem(item, 'edit'));
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
    if (category === 'REVOLVING_CC' || category === 'PAST_DUE_OLA') return 'Planned';
    if (category === 'FIXED_LOAN') return 'Monthly';
    return 'Amount';
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
    const cutoff = this.selectValue(event) as AssignedCutoff;
    const dueDay = cutoff === '15_30' ? '30' : cutoff === 'BOTH' ? '25' : cutoff.startsWith('15') ? '15' : cutoff.startsWith('30') ? '30' : cutoff.startsWith('10') ? '10' : '25';
    this.patch({ cutoff, dueDay });
  }

  saveEditor(): void {
    const form = this.editor();
    if (!form) return;
    if (!form.name.trim()) {
      this.formError.set('Give the bill a name.');
      return;
    }
    const pair = isPairCutoff(form.cutoff);
    const dueDay = pair ? (form.cutoff === '15_30' ? 30 : 25) : Number(form.dueDay);
    if (!pair && (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31)) {
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
      if (monthlyAmortization <= 0) return this.formError.set('Enter the amount.');
    } else if (category === 'ONE_TIME_OLA') {
      if (totalBalance <= 0) return this.formError.set('Enter the amount to pay.');
      monthlyAmortization = totalBalance;
      remainingTerms = 1;
    } else if (category === 'REVOLVING_CC') {
      if (totalBalance <= 0) return this.formError.set('Enter the card balance.');
      if (monthlyAmortization <= 0) monthlyAmortization = minimumDue ?? 0;
      if (monthlyAmortization <= 0) return this.formError.set('Enter a planned payment or a minimum due.');
    } else if (category === 'PERSONAL_DEBT') {
      if (totalBalance <= 0) return this.formError.set('Enter the balance.');
      if (monthlyAmortization <= 0) return this.formError.set('Enter the amount you pay.');
      remainingTerms = remainingTerms && remainingTerms > 0 ? remainingTerms : undefined;
    } else if (totalBalance <= 0) {
      return this.formError.set('Enter the balance.');
    } else if (monthlyAmortization <= 0) {
      return this.formError.set('Enter the planned payment.');
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
      splitAcrossCutoffs: pair,
      remainingTerms,
      startDate: this.shows(form, 'startDate') ? form.startDate || todayIso() : adding ? todayIso() : form.startDate,
      endDate: this.shows(form, 'endDate') || !adding ? form.endDate : '',
      status: form.status,
      notes: form.notes,
      addToFutureCutoffs: form.addToCycles,
    };
    const savedName = form.name.trim();
    if (form.mode === 'add') {
      const firstCutoff = this.budget.addLiability(draft);
      this.notice.set(
        firstCutoff
          ? `${savedName} was added to the ${formatLongDate(firstCutoff)} payments cutoff.`
          : `${savedName} was added.`,
      );
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
    };
  }
}
