import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'cutoffs',
    loadComponent: () => import('./pages/cutoff-planner/cutoff-planner.component').then((m) => m.CutoffPlannerComponent),
  },
  {
    path: 'income',
    loadComponent: () => import('./pages/income/income.component').then((m) => m.IncomeComponent),
  },
  {
    path: 'debts',
    loadComponent: () => import('./pages/debt-inventory/debt-inventory.component').then((m) => m.DebtInventoryComponent),
  },
  {
    path: 'savings',
    loadComponent: () => import('./pages/savings/savings.component').then((m) => m.SavingsComponent),
  },
  {
    path: 'accounts',
    loadComponent: () => import('./pages/accounts/accounts.component').then((m) => m.AccountsComponent),
  },
  {
    path: 'withdrawals',
    loadComponent: () => import('./pages/withdrawals/withdrawals.component').then((m) => m.WithdrawalsComponent),
  },
  {
    path: 'shared-expenses',
    loadComponent: () => import('./pages/shared-expenses/shared-expenses.component').then((m) => m.SharedExpensesComponent),
  },
  {
    path: 'owes-you',
    loadComponent: () => import('./pages/receivables/receivables.component').then((m) => m.ReceivablesComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];

