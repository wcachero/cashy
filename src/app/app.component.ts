import { ChangeDetectionStrategy, Component, HostListener, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  LucideBell,
  LucideCalendarRange,
  LucideHandCoins,
  LucideLandmark,
  LucideLayoutDashboard,
  LucideLogOut,
  LucidePiggyBank,
  LucideSettings,
  LucideWallet,
} from '@lucide/angular';
import { duePhrase, formatShortDate, formatWeekday, today } from './core/dates';
import { AuthComponent } from './pages/auth/auth.component';
import { AuthService } from './services/auth.service';
import { BudgetStateService } from './services/budget-state.service';
import { DueNotificationService } from './services/due-notification.service';
import { PhpPipe } from './shared/php.pipe';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    PhpPipe,
    LucideLayoutDashboard,
    LucideCalendarRange,
    LucideLandmark,
    LucideSettings,
    LucideBell,
    LucideLogOut,
    LucidePiggyBank,
    LucideHandCoins,
    LucideWallet,
    AuthComponent,
  ],
  template: `
    @if (!auth.ready() || (auth.user() && !budget.loaded())) {
      <main class="grid min-h-screen place-items-center text-sm text-slate-400">Opening your plan…</main>
    } @else if (!auth.user()) {
      <app-auth />
    } @else {
    <div class="pointer-events-none fixed inset-0 -z-10">
      <div class="absolute -left-20 top-0 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl"></div>
      <div class="absolute right-0 top-32 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl"></div>
    </div>

    <header class="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#07111f]/90 px-4 py-3 backdrop-blur md:hidden">
      <a routerLink="/dashboard" class="flex items-center gap-2">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400 font-extrabold text-slate-950">₱</span>
        <span class="text-lg font-bold tracking-tight">Cashy</span>
      </a>
      <div class="flex items-center gap-2">
        <button type="button" class="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-slate-300" aria-label="Sign out" (click)="logout()">
          <svg lucideLogOut [size]="16"></svg>
        </button>
        <button type="button" class="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 text-amber-200" aria-label="Notifications" [attr.aria-expanded]="notificationsOpen()" (click)="toggleNotifications()">
          <svg lucideBell [size]="18"></svg>
          @if (alertCount()) {
            <span class="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-950">
              {{ alertCount() }}
            </span>
          }
        </button>
      </div>
    </header>

    <aside class="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-slate-950/70 px-4 py-6 backdrop-blur md:flex">
      <div class="flex items-start justify-between gap-2 px-2">
        <a routerLink="/dashboard" class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400 text-xl font-extrabold text-slate-950">₱</span>
          <span>
            <span class="block text-lg font-bold leading-none">Cashy</span>
            <span class="mt-1 block text-xs text-slate-400">Cash flow & Finance Planner</span>
          </span>
        </a>
        <button type="button" class="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-amber-200" aria-label="Notifications" [attr.aria-expanded]="notificationsOpen()" (click)="toggleNotifications()">
          <svg lucideBell [size]="18"></svg>
          @if (alertCount()) {
            <span class="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-950">
              {{ alertCount() }}
            </span>
          }
        </button>
      </div>

      <nav class="mt-8 flex flex-1 flex-col gap-1" aria-label="Primary">
        @for (item of nav; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="bg-emerald-400/15 text-emerald-100"
            [routerLinkActiveOptions]="{ exact: true }"
            class="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            @switch (item.icon) {
              @case ('dashboard') { <svg lucideLayoutDashboard [size]="18"></svg> }
              @case ('cutoffs') { <svg lucideCalendarRange [size]="18"></svg> }
              @case ('income') { <svg lucideWallet [size]="18"></svg> }
              @case ('debts') { <svg lucideLandmark [size]="18"></svg> }
              @case ('savings') { <svg lucidePiggyBank [size]="18"></svg> }
              @case ('owes') { <svg lucideHandCoins [size]="18"></svg> }
              @case ('settings') { <svg lucideSettings [size]="18"></svg> }
            }
            <span class="flex-1">{{ item.label }}</span>
            @if (item.icon === 'dashboard' && budget.upcomingDues().length) {
              <span class="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-950">{{ budget.upcomingDues().length }}</span>
            }
          </a>
        }
      </nav>

      @if (budget.upcomingCycle(); as cycle) {
        <a routerLink="/cutoffs" [queryParams]="{ cycle: cycle.id }" class="rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-emerald-400/40">
          <span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next cutoff</span>
          <span class="mt-1 block font-semibold">{{ shortDate(cycle.cutoffDate) }}</span>
          <span class="mt-1 block font-mono text-sm text-emerald-300">{{ budget.cycleInflow(cycle) | php }}</span>
        </a>
      }
      <button type="button" class="mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white" (click)="logout()">
        <svg lucideLogOut [size]="16"></svg>
        Sign out {{ auth.user()?.name }}
      </button>
    </aside>

    <main class="min-h-screen md:pl-64">
      <div class="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:px-8 md:pb-12 md:pt-8">
        @if (budget.saveError()) {
          <p class="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{{ budget.saveError() }}</p>
        }
        <router-outlet />
      </div>
    </main>

    @if (notificationsOpen()) {
      <button type="button" class="fixed inset-0 z-[60] cursor-default bg-slate-950/40" aria-label="Close notifications" (click)="notificationsOpen.set(false)"></button>
      <section class="fixed right-4 top-[4.25rem] z-[70] w-[min(22rem,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-2xl md:left-[17.5rem] md:right-auto md:top-6" role="dialog" aria-label="Due notifications">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-bold">Notifications</h2>
          <button type="button" class="text-xs font-semibold text-slate-400 hover:text-white" (click)="notificationsOpen.set(false)">Close</button>
        </div>
        @if (alertCount() === 0) {
          <p class="mt-3 text-sm text-slate-400">Nothing is due in the next 7 days.</p>
        } @else {
          <ul class="mt-3 max-h-[min(24rem,60vh)] space-y-2 overflow-y-auto">
            @for (due of budget.upcomingDues(); track due.liabilityId + due.dueDate) {
              <li>
                <a routerLink="/dashboard" class="block rounded-2xl border border-amber-300/30 bg-amber-300/10 px-3 py-2.5" (click)="notificationsOpen.set(false)">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100/80">{{ duePhrase(due.daysUntil) }}</p>
                  <p class="mt-1 text-sm font-semibold">{{ due.name }}</p>
                  <p class="mt-1 font-mono text-xs text-amber-50/80">{{ due.suggestedAmount | php }} · {{ shortDate(due.dueDate) }}</p>
                </a>
              </li>
            }
            @for (item of budget.pastDueLiabilities(); track item.id) {
              <li>
                <a routerLink="/debts" class="block rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5" (click)="notificationsOpen.set(false)">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-200">Past due</p>
                  <p class="mt-1 text-sm font-semibold">{{ item.name }}</p>
                  <p class="mt-1 font-mono text-xs text-rose-100">{{ item.totalBalance | php }} still unpaid</p>
                </a>
              </li>
            }
          </ul>
        }
      </section>
    }

    <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#07111f]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
      <div class="grid grid-cols-7">
        @for (item of nav; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="text-emerald-300"
            [routerLinkActiveOptions]="{ exact: true }"
            class="flex flex-col items-center gap-1 px-1 py-2.5 text-center text-[10px] font-medium leading-tight text-slate-400"
          >
            @switch (item.icon) {
              @case ('dashboard') { <svg lucideLayoutDashboard [size]="18"></svg> }
              @case ('cutoffs') { <svg lucideCalendarRange [size]="18"></svg> }
              @case ('income') { <svg lucideWallet [size]="18"></svg> }
              @case ('debts') { <svg lucideLandmark [size]="18"></svg> }
              @case ('savings') { <svg lucidePiggyBank [size]="18"></svg> }
              @case ('owes') { <svg lucideHandCoins [size]="18"></svg> }
              @case ('settings') { <svg lucideSettings [size]="18"></svg> }
            }
            {{ item.label }}
          </a>
        }
      </div>
    </nav>
    }
  `,
})
export class AppComponent {
  readonly budget = inject(BudgetStateService);
  readonly auth = inject(AuthService);
  readonly todayLabel = formatWeekday(today());
  readonly shortDate = formatShortDate;
  readonly duePhrase = duePhrase;
  readonly notificationsOpen = signal(false);
  readonly nav = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/cutoffs', label: 'Cutoffs', icon: 'cutoffs' },
    { path: '/income', label: 'Income', icon: 'income' },
    { path: '/debts', label: 'Debts/Expenses', icon: 'debts' },
    { path: '/savings', label: 'Savings', icon: 'savings' },
    { path: '/owes-you', label: 'Owes you', icon: 'owes' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

  constructor() {
    inject(DueNotificationService);
    void this.boot();
    effect(() => {
      if (!this.auth.user() || !this.budget.loaded()) return;
      const count = this.budget.upcomingDues().length;
      document.title = count > 0 ? `(${count} due) Cashy` : 'Cashy';
    });
  }

  @HostListener('document:keydown.escape')
  closeNotifications(): void {
    this.notificationsOpen.set(false);
  }

  toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open);
  }

  alertCount(): number {
    return this.budget.upcomingDues().length + this.budget.pastDueLiabilities().length;
  }

  async logout(): Promise<void> {
    this.budget.pauseSaves();
    await this.auth.logout();
    document.title = 'Cashy';
  }

  private async boot(): Promise<void> {
    const user = await this.auth.restore();
    if (!user) return;
    try {
      await this.budget.hydrate();
    } catch {
      this.budget.pauseSaves();
      await this.auth.logout();
    }
  }
}
