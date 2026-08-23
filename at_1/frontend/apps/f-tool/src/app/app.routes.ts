import { Route } from '@angular/router';
import { actionGuard, authGuard } from './core/auth/auth.guard';
import { pendingChangesGuard } from './core/pending-changes.guard';
export const appRoutes: Route[] = [
    {
        path: 'login',
        loadComponent: () => import('./features/login/login-container').then((m) => m.LoginContainer),
    },
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./features/shell/shell-container').then((m) => m.ShellContainer),
        children: [
            {
                path: 'home',
                loadComponent: () => import('./features/home/home-container').then((m) => m.HomeContainer),
            },
            {
                path: 'tables',
                canActivate: [actionGuard('tables', 'user')],
                loadComponent: () => import('./features/tables/table-select-container').then((m) => m.TableSelectContainer),
            },
            {
                path: 'tables/:id',
                canActivate: [actionGuard('tables', 'user')],
                canDeactivate: [pendingChangesGuard],
                loadComponent: () => import('./features/tables/tables-container').then((m) => m.TablesContainer),
            },
            {
                path: 'settings',
                canActivate: [actionGuard('settings', 'admin')],
                loadComponent: () => import('./features/settings/settings-menu-container').then((m) => m.SettingsMenuContainer),
            },
            {
                path: 'settings/tables',
                canActivate: [actionGuard('settings', 'admin')],
                loadComponent: () => import('./features/settings/settings-tables-container').then((m) => m.SettingsTablesContainer),
            },
            {
                path: 'settings/home',
                canActivate: [actionGuard('settings', 'admin')],
                canDeactivate: [pendingChangesGuard],
                loadComponent: () => import('./features/settings/settings-home-container').then((m) => m.SettingsHomeContainer),
            },
            {
                path: 'settings/functions',
                canActivate: [actionGuard('settings', 'admin')],
                loadComponent: () => import('./features/settings/settings-functions-container').then((m) => m.SettingsFunctionsContainer),
            },
            {
                path: 'settings/users',
                canActivate: [actionGuard('settings', 'admin')],
                loadComponent: () => import('./features/settings/settings-users-container').then((m) => m.SettingsUsersContainer),
            },
            { path: 'settings/:section', redirectTo: 'settings/tables' },
            {
                path: 'history',
                canActivate: [actionGuard('history', 'maintainer')],
                loadComponent: () => import('./features/history/history-container').then((m) => m.HistoryContainer),
            },
            { path: '', pathMatch: 'full', redirectTo: 'home' },
        ],
    },
    { path: '**', redirectTo: 'home' },
];
