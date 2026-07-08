import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type Permission = 'edit' | 'view' | 'none';

export interface DashboardFunction {
  id: string;
  name: string;
  /** Tabler icon 名 (例: 'database') */
  icon: string;
  permission: Permission;
}

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
}

/**
 * ダッシュボード画面 (A案: クラシック業務系)
 *
 * 認可のある機能へアクセスするための起点画面。
 * - ブランドカラーのヘッダーバー + 左サイドバー
 * - 機能カードは permission に応じて「編集可 / 参照のみ / 権限なし(グレーアウト)」を表示
 * - 権限なしカードはクリック不可
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-page',
  template: `
    <div class="page">
      <header class="header">
        <span class="header-title">
          <i class="ti ti-table" aria-hidden="true"></i> {{ systemName() }}
        </span>
        <span class="header-user">
          <i class="ti ti-user" aria-hidden="true"></i> {{ userName() }}
        </span>
      </header>

      <div class="body">
        <nav class="sidebar" aria-label="メインメニュー">
          @for (item of menuItems(); track item.id) {
            <button
              class="menu-item"
              type="button"
              [class.active]="item.id === activeMenuId()"
              (click)="menuSelected.emit(item.id)"
            >
              <i class="ti ti-{{ item.icon }}" aria-hidden="true"></i>
              {{ item.label }}
            </button>
          }
        </nav>

        <main class="main">
          <p class="greeting">{{ greeting() }}、{{ userName() }}さん</p>

          <div class="cards">
            @for (fn of functions(); track fn.id) {
              <button
                class="card"
                type="button"
                [class.locked]="fn.permission === 'none'"
                [disabled]="fn.permission === 'none'"
                (click)="functionSelected.emit(fn.id)"
              >
                <i
                  class="card-icon ti ti-{{
                    fn.permission === 'none' ? 'lock' : fn.icon
                  }}"
                  aria-hidden="true"
                ></i>
                <span class="card-name">{{ fn.name }}</span>
                <span class="card-perm">{{ permissionLabel(fn.permission) }}</span>
              </button>
            } @empty {
              <p class="empty">アクセス可能な機能がありません。管理者に権限を申請してください。</p>
            }
          </div>
        </main>
      </div>
    </div>
  `,
  styles: `
    .page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--tm-page-bg);
    }
    .header {
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-title {
      font-size: 14px;
      font-weight: 600;
    }
    .header-user {
      font-size: 12px;
    }
    .body {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .sidebar {
      width: 180px;
      background: var(--tm-surface-alt);
      border-right: 1px solid var(--tm-border);
      padding: 12px 0;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
    }
    .menu-item {
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--tm-text-secondary);
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .menu-item:hover {
      background: var(--tm-primary-tint-weak);
    }
    .menu-item.active {
      background: var(--tm-primary-tint);
      border-left-color: var(--tm-primary);
      color: var(--tm-text);
    }
    .main {
      flex: 1;
      padding: 20px 24px;
      background: var(--tm-surface);
    }
    .greeting {
      font-size: 14px;
      margin: 0 0 16px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .card {
      font-family: inherit;
      text-align: left;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .card:hover:not(:disabled) {
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .card.locked {
      opacity: 0.55;
      cursor: default;
    }
    .card-icon {
      font-size: 22px;
      color: var(--tm-primary);
    }
    .card.locked .card-icon {
      color: var(--tm-text-muted);
    }
    .card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
    }
    .card-perm {
      font-size: 11px;
      color: var(--tm-text-muted);
    }
    .empty {
      grid-column: 1 / -1;
      font-size: 13px;
      color: var(--tm-text-muted);
      border: 1px dashed var(--tm-border-strong);
      border-radius: var(--tm-radius);
      padding: 24px;
      text-align: center;
      margin: 0;
    }
  `,
})
export class DashboardPage {
  readonly systemName = input('テーブル管理システム');
  readonly userName = input('山田太郎');
  readonly greeting = input('おはようございます');
  readonly activeMenuId = input('home');

  readonly menuItems = input<MenuItem[]>([
    { id: 'home', label: 'ホーム', icon: 'home' },
    { id: 'master', label: 'マスタ管理', icon: 'database' },
    { id: 'history', label: '変更履歴', icon: 'history' },
    { id: 'settings', label: '設定', icon: 'settings' },
  ]);

  readonly functions = input<DashboardFunction[]>([]);

  /** 機能カード選択時 (機能 id を通知) */
  readonly functionSelected = output<string>();
  /** サイドバーメニュー選択時 (メニュー id を通知) */
  readonly menuSelected = output<string>();

  protected permissionLabel(p: Permission): string {
    switch (p) {
      case 'edit':
        return '参照・編集';
      case 'view':
        return '参照のみ';
      case 'none':
        return '権限なし';
    }
  }
}
