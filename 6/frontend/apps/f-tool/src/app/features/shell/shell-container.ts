// features/shell — 全画面共通のヘッダー+サイドバー(tm-app-shell)のルート親。
// ダッシュボード/テーブル管理/操作履歴/設定の各ルートを router-outlet で子として描画する。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
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

  /** 辞書ロード完了と言語切替で computed を再評価させるための signal。 */
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = computed(
    () => this.auth.me()?.displayName ?? '',
  );

  /**
   * ヘッダー時計の表示設定(個人設定)。個人設定ダイアログと同じストアを
   * 見るので,変えた瞬間にヘッダーへ反映される。
   */
  protected readonly clockMode = this.userSettings.headerClock;
  protected readonly clockFormat = this.userSettings.headerClockFormat;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** 現在の URL からサイドバーのハイライト対象を決める。 */
  protected readonly activeMenuId = computed(() => {
    const url = this.url();
    if (url.startsWith('/tables')) return 'tables';
    if (url.startsWith('/history')) return 'history';
    if (url.startsWith('/settings')) return 'settings';
    return 'home';
  });

  /**
   * サイドバー: ホーム / テーブル管理(tables:user+) /
   * 操作履歴(history:maintainer+) / 設定(settings:admin)。
   * 権限が無い項目は表示されず,直URLもルートガードが弾く。
   */
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

  /** ユーザーメニューの[個人設定]。本人にだけ効く設定をダイアログで編集する。 */
  private openPersonalSettings(): void {
    const ref = openModal(this.dialog, PersonalSettingsDialog, {}, {
      width: '26rem',
      maxWidth: '95vw',
    });
    ref.componentRef?.setInput('settings', this.userSettings.settings());
    // 初回はフェッチ完了を待ってから反映する(2回目以降は即時)。
    ref.componentRef?.setInput('version', this.appVersion.version());
    void this.appVersion.load().then(() => {
      ref.componentRef?.setInput('version', this.appVersion.version());
    });
    const save = (patch: Partial<UserSettings>): void => {
      ref.componentRef?.setInput('errorMessage', null);
      void this.userSettings
        .update(patch)
        .catch((err) => {
          ref.componentRef?.setInput(
            'errorMessage',
            apiErrorText(this.transloco, err, 'errors.updateFailed'),
          );
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
      // 次にログインする人へ個人設定を持ち越さない
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
