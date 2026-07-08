import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * サブ画面(テーブルメンテナンス/設定/履歴)共通のヘッダーバー。
 * ダッシュボードへ戻る導線とログアウトを提供する。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-page-header',
  template: `
    <header class="header">
      <span class="left">
        <button class="back" type="button" (click)="backClicked.emit()" aria-label="ダッシュボードへ戻る">
          <i class="ti ti-arrow-left" aria-hidden="true"></i>
        </button>
        <span class="title">
          <i class="ti ti-table" aria-hidden="true"></i> {{ systemName() }}
        </span>
        <span class="divider">/</span>
        <span class="page-title">{{ pageTitle() }}</span>
      </span>
      <span class="right">
        <span class="user">
          <i class="ti ti-user" aria-hidden="true"></i> {{ userName() }}
        </span>
        <button class="logout" type="button" (click)="logoutClicked.emit()">
          <i class="ti ti-logout" aria-hidden="true"></i> ログアウト
        </button>
      </span>
    </header>
  `,
  styles: `
    .header {
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .left,
    .right {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .back {
      background: transparent;
      border: none;
      color: var(--tm-text-on-primary);
      cursor: pointer;
      font-size: 16px;
      width: 28px;
      height: 28px;
      border-radius: var(--tm-radius);
    }
    .back:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .title {
      font-size: 14px;
      font-weight: 600;
    }
    .divider {
      opacity: 0.6;
    }
    .page-title {
      font-size: 13px;
    }
    .user {
      font-size: 12px;
    }
    .logout {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.5);
      color: var(--tm-text-on-primary);
      border-radius: var(--tm-radius);
      font-size: 12px;
      font-family: inherit;
      padding: 4px 10px;
      cursor: pointer;
    }
    .logout:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  `,
})
export class PageHeader {
  readonly systemName = input('テーブル管理システム');
  readonly pageTitle = input('');
  readonly userName = input('');

  readonly backClicked = output<void>();
  readonly logoutClicked = output<void>();
}
