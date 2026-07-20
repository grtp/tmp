// features/shell — 全画面共通のヘッダー+サイドバー(tm-app-shell)のルート親。
// ダッシュボード/テーブルメンテ/操作履歴/設定の各ルートを router-outlet で子として描画する。
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AppShell, MenuItem } from '@f-tool/ui';
import { filter, map } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-shell-container',
  imports: [AppShell, RouterOutlet],
  templateUrl: './shell-container.html',
})
export class ShellContainer {
  private auth = inject(AuthService);
  private router = inject(Router);
  private transloco = inject(TranslocoService);

  /** 辞書ロード完了と言語切替で computed を再評価させるための signal(dashboard-container と同じ手法)。 */
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

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
    if (url.startsWith('/table-maint')) return 'table-maint';
    if (url.startsWith('/history')) return 'history';
    if (url.startsWith('/settings')) return 'settings';
    return 'home';
  });

  /**
   * サイドバー: ホーム / テーブルメンテ(table-maint:user+) /
   * 操作履歴(history:maintainer+) / 設定(settings:admin)。
   * 権限が無い項目は表示されず，直URLもルートガードが弾く。
   */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    const items: MenuItem[] = [{ id: 'home', label: t('dashboard.menuHome'), icon: 'home' }];
    if (this.auth.allows('table-maint', 'user')) {
      items.push({ id: 'table-maint', label: t('dashboard.menuTableMaint'), icon: 'table' });
    }
    if (this.auth.allows('history', 'maintainer')) {
      items.push({ id: 'history', label: t('dashboard.menuHistory'), icon: 'history' });
    }
    if (this.auth.allows('settings', 'admin')) {
      items.push({ id: 'settings', label: t('pages.settings'), icon: 'settings' });
    }
    return items;
  });

  protected async onMenu(id: string): Promise<void> {
    if (id === 'logout') {
      await this.auth.logout();
      this.router.navigate(['/login']);
      return;
    }
    if (id === 'home') {
      this.router.navigate(['/dashboard']);
      return;
    }
    if (id === 'table-maint') {
      this.router.navigate(['/table-maint']);
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
