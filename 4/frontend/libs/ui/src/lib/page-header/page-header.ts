import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import { Lang, storeLang } from '../i18n/provide-i18n';

/**
 * サブ画面(テーブルメンテナンス/設定/履歴)共通のヘッダーバー。
 * ダッシュボードへ戻る導線・言語切替・ログアウトを提供する。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-page-header',
  imports: [TranslocoPipe],
  template: `
    <header class="header">
      <span class="left">
        <button
          class="back"
          type="button"
          (click)="backClicked.emit()"
          [attr.aria-label]="'common.backToDashboard' | transloco"
        >
          <i class="ti ti-arrow-left" aria-hidden="true"></i>
        </button>
        <span class="title">
          <i class="ti ti-table" aria-hidden="true"></i> {{ systemName() }}
        </span>
        <span class="divider">/</span>
        <span class="page-title">{{ pageTitle() }}</span>
      </span>
      <span class="right">
        <button class="lang" type="button" (click)="toggleLang()" aria-label="Language">
          <i class="ti ti-language" aria-hidden="true"></i> {{ activeLang() === 'ja' ? 'EN' : '日本語' }}
        </button>
        <span class="user">
          <i class="ti ti-user" aria-hidden="true"></i> {{ userName() }}
        </span>
        <button class="logout" type="button" (click)="logoutClicked.emit()">
          <i class="ti ti-logout" aria-hidden="true"></i> {{ 'common.logout' | transloco }}
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
    .lang {
      background: transparent;
      border: none;
      color: var(--tm-text-on-primary);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: var(--tm-radius);
      opacity: 0.9;
    }
    .lang:hover {
      background: rgba(255, 255, 255, 0.15);
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
  private transloco = inject(TranslocoService);

  /** システム名(ブランド名のため翻訳しない) */
  readonly systemName = input('FORGE');
  readonly pageTitle = input('');
  readonly userName = input('');

  readonly backClicked = output<void>();
  readonly logoutClicked = output<void>();

  protected readonly activeLang = signal(this.transloco.getActiveLang());

  protected toggleLang(): void {
    const next: Lang = this.activeLang() === 'ja' ? 'en' : 'ja';
    this.transloco.setActiveLang(next);
    storeLang(next);
    this.activeLang.set(next);
  }
}
