import { ChangeDetectionStrategy, Component, computed, inject, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { SettingsMenu, SettingsMenuItem } from '@f-tool/ui';
import { AuthService } from '../../core/auth/auth.service';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-menu-container',
    styles: ':host { display: contents; }',
    imports: [SettingsMenu],
    templateUrl: './settings-menu-container.html',
})
export class SettingsMenuContainer {
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private auth = inject(AuthService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly items = computed<SettingsMenuItem[]>(() => {
        void this.lang();
        const t = (key: string) => this.transloco.translate(key);
        const items: SettingsMenuItem[] = [
            {
                id: 'home',
                name: t('settingsMenu.home'),
                description: t('settingsMenu.homeDesc'),
                icon: 'dashboard_customize',
            },
            {
                id: 'tables',
                name: t('settingsMenu.tables'),
                description: t('settingsMenu.tablesDesc'),
                icon: 'table_view',
            },
            {
                id: 'functions',
                name: t('settingsMenu.functions'),
                description: t('settingsMenu.functionsDesc'),
                icon: 'apps',
            },
            {
                id: 'users',
                name: t('settingsMenu.users'),
                description: t('settingsMenu.usersDesc'),
                icon: 'admin_panel_settings',
            },
            {
                id: 'groups',
                name: t('settingsMenu.groups'),
                description: t('settingsMenu.groupsDesc'),
                icon: 'group',
            },
        ];
        if (this.auth.allows('pwchange', 'maintainer')) {
            items.push({
                id: 'pwchange',
                name: t('settingsMenu.pwchange'),
                description: t('settingsMenu.pwchangeDesc'),
                icon: 'password',
            });
        }
        return items;
    });
    protected open(id: string): void {
        if (id === 'pwchange') {
            this.router.navigate(['/pwchange/targets']);
            return;
        }
        this.router.navigate(['/settings', id]);
    }
}
