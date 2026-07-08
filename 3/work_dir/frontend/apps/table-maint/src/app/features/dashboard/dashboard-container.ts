// features/dashboard — /auth/me の actions を tm-dashboard-page のカードへ写す。
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardFunction, DashboardPage, MenuItem } from '@table-maint/ui';

import { AuthService } from '../../core/auth/auth.service';
import { AuthLevel } from '../../core/models';

/** auth_level -> カードの permission 表示。 */
function toPermission(level: AuthLevel): 'edit' | 'view' {
  return level === 'user' ? 'view' : 'edit';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-container',
  imports: [DashboardPage],
  template: `
    <tm-dashboard-page
      [userName]="userName()"
      [greeting]="greeting()"
      [menuItems]="menuItems()"
      activeMenuId="home"
      [functions]="functions()"
      (functionSelected)="onFunction($event)"
      (menuSelected)="onMenu($event)"
    />
  `,
})
export class DashboardContainer {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    if (h < 5) return 'おつかれさまです';
    if (h < 11) return 'おはようございます';
    if (h < 18) return 'こんにちは';
    return 'おつかれさまです';
  });

  /** サイドメニュー: ホーム + ログアウト(+ admin はショートカット)。 */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [{ id: 'home', label: 'ホーム', icon: 'home' }];
    if (this.auth.allows('settings', 'admin')) {
      items.push({ id: 'history', label: '操作履歴', icon: 'history' });
    }
    items.push({ id: 'logout', label: 'ログアウト', icon: 'logout' });
    return items;
  });

  /** 権限のある機能のカード。 */
  protected readonly functions = computed<DashboardFunction[]>(() =>
    this.auth.actions().map((a) => ({
      id: a.code,
      name: a.name,
      icon: a.icon,
      permission: toPermission(a.authLevel),
    })),
  );

  protected onFunction(code: string): void {
    // 組込機能はルートへ。追加機能(将来)は code = ルートパスの規約。
    this.router.navigate(['/', code]);
  }

  protected async onMenu(id: string): Promise<void> {
    if (id === 'logout') {
      await this.auth.logout();
      this.router.navigate(['/login']);
      return;
    }
    if (id === 'history') {
      this.router.navigate(['/history']);
    }
  }
}
