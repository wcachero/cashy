import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideBell, LucideDownload, LucideRotateCcw, LucideUpload } from '@lucide/angular';
import { todayIso } from '../../core/dates';
import { toFinanceExport } from '../../core/finance-export';
import { BudgetStateService } from '../../services/budget-state.service';
import { DueNotificationService } from '../../services/due-notification.service';
import { ModalComponent } from '../../shared/modal.component';
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, LucideDownload, LucideUpload, LucideRotateCcw, LucideBell],
  template: `
    <section>
      <p class="text-sm text-slate-400">Backup and alerts</p>
      <h1 class="mt-1 text-3xl font-extrabold tracking-tight">Settings</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-400">
        Your plan is saved in <span class="font-mono text-slate-300">data/cutoff.sqlite</span> for this login. Export includes income, loans, credit cards, OLA bank names, and living expenses.
      </p>
    </section>

    @if (message()) {
      <p class="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{{ message() }}</p>
    }

    <section class="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 p-5">
      <div class="flex items-start gap-3">
        <span class="grid h-10 w-10 place-items-center rounded-2xl bg-amber-300 text-slate-950">
          <svg lucideBell [size]="18"></svg>
        </span>
        <div>
          <h2 class="text-lg font-bold">Payment notifications</h2>
          <p class="mt-1 text-sm text-slate-400">
            Bills due within 7 days always show on the dashboard. Turn on browser alerts to also get a notification when you open Cashy.
          </p>
        </div>
      </div>
      <button type="button" class="mt-4 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950" (click)="toggleNotifications()">
        {{ budget.notificationsEnabled() ? 'Turn alerts off' : 'Enable browser alerts' }}
      </button>
      <p class="mt-2 text-xs text-slate-500">
        Status: {{ budget.notificationsEnabled() ? 'On' : 'Off' }}. Alerts fire while this site is open; they are not a background service.
      </p>
    </section>

    <section class="mt-4 grid gap-3 md:grid-cols-3">
      <button type="button" class="rounded-3xl border border-white/10 bg-slate-900/70 p-5 text-left transition hover:border-emerald-400/40" (click)="exportBackup()">
        <svg lucideDownload [size]="20" class="text-emerald-300"></svg>
        <h2 class="mt-3 font-bold">Export plan</h2>
        <p class="mt-1 text-sm text-slate-400">Download financial-plan-{{ today }}.json with OLAs, bank names, and expenses.</p>
      </button>
      <label class="cursor-pointer rounded-3xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-emerald-400/40">
        <svg lucideUpload [size]="20" class="text-sky-300"></svg>
        <h2 class="mt-3 font-bold">Import plan</h2>
        <p class="mt-1 text-sm text-slate-400">Choose financial-plan-2026-10-15.json, or any Cashy export.</p>
        <input class="sr-only" type="file" accept="application/json,.json" (change)="importBackup($event)" />
      </label>
      <button type="button" class="rounded-3xl border border-rose-400/30 bg-rose-400/10 p-5 text-left" (click)="confirmReset.set(true)">
        <svg lucideRotateCcw [size]="20" class="text-rose-200"></svg>
        <h2 class="mt-3 font-bold">Clear plan</h2>
        <p class="mt-1 text-sm text-rose-100/80">Remove income, debts, expenses, savings, and cutoffs.</p>
      </button>
    </section>

    <p class="mt-6 text-sm text-slate-400">
      Salary, money owed to you, and other income are edited in <a routerLink="/income" class="font-semibold text-emerald-300">Income</a>.
    </p>

    <app-modal [open]="confirmReset()" (closed)="confirmReset.set(false)">
      <h2 class="text-xl font-bold">Clear this plan?</h2>
      <p class="mt-2 text-sm text-slate-400">
        This removes income, debts, expenses, savings, cutoffs, and money owed to you from this account. A file you already downloaded stays as it is.
      </p>
      <div class="mt-5 flex flex-wrap gap-2">
        <button type="button" class="rounded-2xl bg-rose-400 px-4 py-2 text-sm font-bold text-slate-950" (click)="reset()">Clear plan</button>
        <button type="button" class="rounded-2xl border border-white/15 px-4 py-2 text-sm" (click)="confirmReset.set(false)">Keep my data</button>
      </div>
    </app-modal>
  `,
})
export class SettingsComponent {
  readonly budget = inject(BudgetStateService);
  private readonly notifications = inject(DueNotificationService);
  readonly message = signal('');
  readonly confirmReset = signal(false);
  readonly today = todayIso();

  exportBackup(): void {
    const snapshot = this.budget.exportSnapshot();
    const file = toFinanceExport(snapshot, todayIso());
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `financial-plan-${todayIso()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.message.set('Finance export downloaded. It includes OLA bank names and living expenses.');
  }

  importBackup(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const restored = this.budget.importSnapshot(parsed);
        this.message.set(restored ? 'Backup restored.' : 'That file is not a Cashy backup.');
      } catch {
        this.message.set('That file is not valid JSON.');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  async toggleNotifications(): Promise<void> {
    if (this.budget.notificationsEnabled()) {
      this.budget.setNotificationsEnabled(false);
      this.message.set('Browser alerts are off. Dashboard banners stay on.');
      return;
    }
    const granted = await this.notifications.requestPermission();
    this.message.set(
      granted
        ? 'Browser alerts are on for bills due within 7 days.'
        : 'The browser did not allow notifications. Dashboard banners still show.',
    );
  }

  reset(): void {
    this.budget.resetToSeed();
    this.confirmReset.set(false);
    this.message.set('Plan cleared.');
  }
}
