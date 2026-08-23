import { ChangeDetectionStrategy, Component, computed, inject, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AppShell, MenuItem, PersonalSettingsDialog } from '@f-tool/ui';
import { filter, map } from 'rxjs';
import { UserSettingsService } from '../../core/user-settings.service';
import { UserSettings } from '../../core/models';
import { apiErrorText } from '../../core/api-errors';
import { AppVersionService } from '../../core/app-version';
import { openModal } from '../../core/dialog';
import { AuthService } from '../../core/auth/auth.service';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-shell-container',
    imports: [AppShell, RouterOutlet],
    templateUrl: './shell-container.html',
})
export class ShellContainer {
    private userSettings = inject(UserSettingsService);
    private appVersion = inject(AppVersionService);
    private dialog = inject(MatDialog);
    private auth = inject(AuthService);
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');
    protected readonly clockMode = this.userSettings.headerClock;
    protected readonly clockFormat = this.userSettings.headerClockFormat;
    private readonly url = toSignal(this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
    protected readonly activeMenuId = computed(() => {
        const url = this.url();
        if (url.startsWith('/tables'))
            return 'tables';
        if (url.startsWith('/history'))
            return 'history';
        if (url.startsWith('/settings'))
            return 'settings';
        return 'home';
    });
    protected readonly menuItems = computed<MenuItem[]>(() => {
        void this.lang();
        const t = (key: string) => this.transloco.translate(key);
        const items: MenuItem[] = [
            { id: 'home', label: t('menu.home'), icon: 'home' },
        ];
        if (this.auth.allows('tables', 'user')) {
            items.push({
                id: 'tables',
                label: t('menu.tables'),
                icon: 'table_view',
            });
        }
        if (this.auth.allows('history', 'maintainer')) {
            items.push({
                id: 'history',
                label: t('menu.history'),
                icon: 'history',
            });
        }
        if (this.auth.allows('settings', 'admin')) {
            items.push({
                id: 'settings',
                label: t('pages.settings'),
                icon: 'settings',
            });
        }
        return items;
    });
    constructor() {
        void this.userSettings.load();
    }
    private openPersonalSettings(): void {
        const ref = openModal(this.dialog, PersonalSettingsDialog, {}, {
            width: '26rem',
            maxWidth: '95vw',
        });
        ref.componentRef?.setInput('settings', this.userSettings.settings());
        ref.componentRef?.setInput('version', this.appVersion.version());
        void this.appVersion.load().then(() => {
            ref.componentRef?.setInput('version', this.appVersion.version());
        });
        const save = (patch: Partial<UserSettings>): void => {
            ref.componentRef?.setInput('errorMessage', null);
            void this.userSettings
                .update(patch)
                .catch((err) => {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.updateFailed'));
            })
                .finally(() => {
                ref.componentRef?.setInput('settings', this.userSettings.settings());
            });
        };
        ref.componentInstance.clockModeChanged.subscribe((mode) => {
            save({ headerClock: mode });
        });
        ref.componentInstance.clockFormatChanged.subscribe((format) => {
            save({ headerClockFormat: format });
        });
    }
    protected async onMenu(id: string): Promise<void> {
        if (id === 'logout') {
            await this.auth.logout();
            this.userSettings.reset();
            this.router.navigate(['/login']);
            return;
        }
        if (id === 'personal-settings') {
            this.openPersonalSettings();
            return;
        }
        if (id === 'home') {
            this.router.navigate(['/home']);
            return;
        }
        if (id === 'tables') {
            this.router.navigate(['/tables']);
            return;
        }
        if (id === 'history') {
            this.router.navigate(['/history']);
            return;
        }
        if (id === 'settings') {
            this.router.navigate(['/settings']);
        }
    }
}
