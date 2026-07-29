// features/settings — 設定トップ: 機能単位のカードで編集対象を選ぶ。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { SettingsMenu, SettingsMenuItem } from '@f-tool/ui';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-menu-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [SettingsMenu],
  templateUrl: './settings-menu-container.html',
})
export class SettingsMenuContainer {
  private router = inject(Router);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で再評価(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly items = computed<SettingsMenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    return [
      {
        id: 'table-maint',
        name: t('settingsMenu.tableMaint'),
        description: t('settingsMenu.tableMaintDesc'),
        icon: 'table_view',
      },
      {
        id: 'dashboard',
        name: t('settingsMenu.dashboard'),
        description: t('settingsMenu.dashboardDesc'),
        icon: 'home',
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
        icon: 'group',
      },
    ];
  });

  protected open(id: string): void {
    this.router.navigate(['/settings', id]);
  }
}
