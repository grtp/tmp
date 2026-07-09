import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import { Lang, storeLang } from '../i18n/provide-i18n';

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

/** ユーザー個人のリンクカード。 */
export interface PersonalLink {
  id: number;
  name: string;
  url: string;
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
  imports: [TranslocoPipe],
  template: `
    <div class="page">
      <header class="header">
        <span class="header-title">
          <i class="ti ti-table" aria-hidden="true"></i> {{ systemName() }}
        </span>
        <span class="header-right">
          <button class="lang" type="button" (click)="toggleLang()" aria-label="Language">
            <i class="ti ti-language" aria-hidden="true"></i> {{ activeLang() === 'ja' ? 'EN' : '日本語' }}
          </button>
          <span class="header-user">
            <i class="ti ti-user" aria-hidden="true"></i> {{ userName() }}
          </span>
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
          <p class="greeting">{{ greeting() }}</p>

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
                <span class="card-perm">{{ permissionKey(fn.permission) | transloco }}</span>
              </button>
            } @empty {
              @if (personalLinks().length === 0) {
                <p class="empty">{{ 'dashboard.empty' | transloco }}</p>
              }
            }

            <!-- 個人リンクカード(本人のみ表示。ホバーで編集/削除) -->
            @for (link of personalLinks(); track link.id) {
              <div class="card personal">
                <button class="card-body" type="button" (click)="linkSelected.emit(link)">
                  <i class="card-icon ti ti-{{ link.icon }}" aria-hidden="true"></i>
                  <span class="card-name">
                    {{ link.name }}
                    <i class="ti ti-external-link ext" aria-hidden="true"></i>
                  </span>
                  <span class="card-perm">{{ 'dashboard.myLink' | transloco }}</span>
                </button>
                <span class="link-ops">
                  <button class="mini" type="button" (click)="linkEditClicked.emit(link)"
                    [attr.aria-label]="'settings.editAria' | transloco">
                    <i class="ti ti-pencil" aria-hidden="true"></i>
                  </button>
                  <button class="mini danger" type="button" (click)="linkDeleteClicked.emit(link)"
                    [attr.aria-label]="'settings.deleteAria' | transloco">
                    <i class="ti ti-x" aria-hidden="true"></i>
                  </button>
                </span>
              </div>
            }

            <!-- リンク追加カード -->
            <button class="card add-link" type="button" (click)="linkAddClicked.emit()">
              <i class="card-icon ti ti-plus" aria-hidden="true"></i>
              <span class="card-name">{{ 'dashboard.addLink' | transloco }}</span>
            </button>
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
    .header-right {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .header-user {
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
    .card-name .ext {
      font-size: 12px;
      color: var(--tm-text-muted);
      margin-left: 2px;
    }
    .card.personal {
      position: relative;
      padding: 0;
      cursor: default;
    }
    .card.personal .card-body {
      font-family: inherit;
      text-align: left;
      background: transparent;
      border: none;
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      box-sizing: border-box;
    }
    .link-ops {
      position: absolute;
      top: 6px;
      right: 6px;
      display: none;
      gap: 4px;
    }
    .card.personal:hover .link-ops {
      display: inline-flex;
    }
    .mini {
      border: 1px solid var(--tm-border);
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: 22px;
      height: 22px;
      cursor: pointer;
      color: var(--tm-text-secondary);
      font-size: 11px;
      padding: 0;
    }
    .mini.danger {
      color: var(--tm-danger);
      border-color: var(--tm-danger);
    }
    .mini.danger:hover {
      background: var(--tm-danger-bg);
    }
    .card.add-link {
      border-style: dashed;
      border-color: var(--tm-border-strong);
      background: transparent;
      align-items: center;
      justify-content: center;
    }
    .card.add-link .card-icon,
    .card.add-link .card-name {
      color: var(--tm-text-muted);
      font-weight: 400;
    }
    .card.add-link:hover {
      border-color: var(--tm-primary);
      box-shadow: none;
    }
    .card.add-link:hover .card-icon,
    .card.add-link:hover .card-name {
      color: var(--tm-primary);
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
  private transloco = inject(TranslocoService);

  /** システム名(ブランド名のため翻訳しない) */
  readonly systemName = input('FORGE');
  readonly userName = input('');
  /** 挨拶文(名前込みの完成文をコンテナが渡す) */
  readonly greeting = input('');
  readonly activeMenuId = input('home');

  readonly menuItems = input<MenuItem[]>([]);

  readonly functions = input<DashboardFunction[]>([]);
  /** ユーザー個人のリンクカード(機能カードの後ろに並ぶ) */
  readonly personalLinks = input<PersonalLink[]>([]);

  /** 機能カード選択時 (機能 id を通知) */
  readonly functionSelected = output<string>();
  /** サイドバーメニュー選択時 (メニュー id を通知) */
  readonly menuSelected = output<string>();
  /** 個人リンクカードのクリック(URL を開くのはコンテナの責務) */
  readonly linkSelected = output<PersonalLink>();
  readonly linkAddClicked = output<void>();
  readonly linkEditClicked = output<PersonalLink>();
  readonly linkDeleteClicked = output<PersonalLink>();

  protected readonly activeLang = signal(this.transloco.getActiveLang());

  protected toggleLang(): void {
    const next: Lang = this.activeLang() === 'ja' ? 'en' : 'ja';
    this.transloco.setActiveLang(next);
    storeLang(next);
    this.activeLang.set(next);
  }

  protected permissionKey(p: Permission): string {
    switch (p) {
      case 'edit':
        return 'dashboard.permissionEdit';
      case 'view':
        return 'dashboard.permissionView';
      case 'none':
        return 'dashboard.permissionNone';
    }
  }
}
