import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'table_maint',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/table-maint/table-maint').then((m) => m.TableMaint),
  },
  { path: '**', redirectTo: '' },
];
