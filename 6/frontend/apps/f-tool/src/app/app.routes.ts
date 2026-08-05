import { Route } from '@angular/router';

import { actionGuard, authGuard } from './core/auth/auth.guard';
import { pendingChangesGuard } from './core/pending-changes.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login-container').then((m) => m.LoginContainer),
  },
  {
    // 認証済みの全画面共通シェル(ヘッダー+サイドバー)。中身は子ルートで router-outlet に差し込む。
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shell/shell-container').then((m) => m.ShellContainer),
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./features/home/home-container').then((m) => m.HomeContainer),
      },
      {
        path: 'tables',
        canActivate: [actionGuard('tables', 'user')],
        loadComponent: () =>
          import('./features/tables/table-select-container').then(
            (m) => m.TableSelectContainer,
          ),
      },
      {
        path: 'tables/:id',
        canActivate: [actionGuard('tables', 'user')],
        // DB 未反映の取込行((*)行)が残っている間は離脱前に確認を挟む
        canDeactivate: [pendingChangesGuard],
        loadComponent: () =>
          import('./features/tables/tables-container').then(
            (m) => m.TablesContainer,
          ),
      },
      {
        path: 'settings',
        canActivate: [actionGuard('settings', 'admin')],
        loadComponent: () =>
          import('./features/settings/settings-menu-container').then(
            (m) => m.SettingsMenuContainer,
          ),
      },
      {
        path: 'settings/tables',
        canActivate: [actionGuard('settings', 'admin')],
        loadComponent: () =>
          import('./features/settings/settings-tables-container').then(
            (m) => m.SettingsTablesContainer,
          ),
      },
      {
        path: 'settings/home',
        canActivate: [actionGuard('settings', 'admin')],
        // ビルダーに未保存の変更がある間は離脱前に確認を挟む
        canDeactivate: [pendingChangesGuard],
        loadComponent: () =>
          import('./features/settings/settings-home-container').then(
            (m) => m.SettingsHomeContainer,
          ),
      },
      {
        path: 'settings/functions',
        canActivate: [actionGuard('settings', 'admin')],
        loadComponent: () =>
          import('./features/settings/settings-functions-container').then(
            (m) => m.SettingsFunctionsContainer,
          ),
      },
      {
        path: 'settings/users',
        canActivate: [actionGuard('settings', 'admin')],
        loadComponent: () =>
          import('./features/settings/settings-users-container').then(
            (m) => m.SettingsUsersContainer,
          ),
      },
      // 旧 /settings/:section 形式の未知セクションは従来の既定に合わせて tables へ。
      { path: 'settings/:section', redirectTo: 'settings/tables' },
      {
        path: 'history',
        canActivate: [actionGuard('history', 'maintainer')],
        loadComponent: () =>
          import('./features/history/history-container').then((m) => m.HistoryContainer),
      },
      { path: '', pathMatch: 'full', redirectTo: 'home' },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
