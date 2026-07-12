// features/settings — 設定トップ: 機能単位のカードで編集対象を選ぶ。
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { PageHeader, SettingsMenu, SettingsMenuItem } from '@table-maint/ui';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-menu-container',
  imports: [SettingsMenu, PageHeader, TranslocoPipe],
  templateUrl: './settings-menu-container.html',
})
export class SettingsMenuContainer {
  protected readonly router = inject(Router);
  private auth = inject(AuthService);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で再評価(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  protected readonly items = computed<SettingsMenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    return [
      {
        id: 'table-maint',
        name: t('settingsMenu.tableMaint'),
        description: t('settingsMenu.tableMaintDesc'),
        icon: 'table',
      },
      {
        id: 'dashboard',
        name: t('settingsMenu.dashboard'),
        description: t('settingsMenu.dashboardDesc'),
        icon: 'layout-dashboard',
      },
      {
        id: 'users',
        name: t('settingsMenu.users'),
        description: t('settingsMenu.usersDesc'),
        icon: 'users',
      },
    ];
  });

  protected open(id: string): void {
    this.router.navigate(['/settings', id]);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
