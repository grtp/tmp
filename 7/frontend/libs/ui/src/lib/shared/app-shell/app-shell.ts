import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { LangSelect } from '../lang-select/lang-select';
import { UserMenu } from '../user-menu/user-menu';

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
}

const SIDEBAR_COLLAPSED_KEY = 'ftool.sidebarCollapsed';

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 全画面共通のシェル(ヘッダー+サイドバー)。中身は ng-content で受け取る
 * (ダッシュボード/テーブルメンテ/操作履歴/設定のどの画面でも同じ構造)。
 *
 * サイドバー開閉に応じてヘッダーは テキストのみ/ロゴアイコンのみ を切り替える
 * (両方出すと F アイコン + F-tool の文字重複になるため)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-app-shell',
  imports: [TranslocoPipe, LangSelect, UserMenu],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {
  /** システム名(ブランド名のため翻訳しない) */
  readonly systemName = input('F-tool');
  readonly userName = input('');
  readonly activeMenuId = input('home');
  readonly menuItems = input<MenuItem[]>([]);

  /** 'home' / 'table-maint' / 'history' / 'settings' / 'logout' */
  readonly menuSelected = output<string>();

  /** サイドバー開閉(端末に localStorage で永続化)。 */
  protected readonly sidebarCollapsed = signal(loadSidebarCollapsed());

  protected toggleSidebar(): void {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 永続化できなくても開閉自体は継続する
    }
  }
}
