import { Route } from '@angular/router';

import { actionGuard, authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login-container').then((m) => m.LoginContainer),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard-container').then((m) => m.DashboardContainer),
  },
  {
    path: 'table-maint',
    canActivate: [authGuard, actionGuard('table-maint', 'user')],
    loadComponent: () =>
      import('./features/table-maint/table-select-container').then(
        (m) => m.TableSelectContainer,
      ),
  },
  {
    path: 'table-maint/:id',
    canActivate: [authGuard, actionGuard('table-maint', 'user')],
    loadComponent: () =>
      import('./features/table-maint/table-maint-container').then(
        (m) => m.TableMaintContainer,
      ),
  },
  {
    path: 'settings',
    canActivate: [authGuard, actionGuard('settings', 'admin')],
    loadComponent: () =>
      import('./features/settings/settings-menu-container').then(
        (m) => m.SettingsMenuContainer,
      ),
  },
  {
    path: 'settings/:section',
    canActivate: [authGuard, actionGuard('settings', 'admin')],
    loadComponent: () =>
      import('./features/settings/settings-container').then((m) => m.SettingsContainer),
  },
  {
    path: 'history',
    canActivate: [authGuard, actionGuard('history', 'maintainer')],
    loadComponent: () =>
      import('./features/history/history-container').then((m) => m.HistoryContainer),
  },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
