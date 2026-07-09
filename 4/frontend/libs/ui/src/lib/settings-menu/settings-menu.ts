import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** 設定トップのカード1枚 = 設定セクション。 */
export interface SettingsMenuItem {
  id: string;
  name: string;
  description: string;
  /** Tabler icon 名 */
  icon: string;
}

/**
 * 設定トップ: 機能単位のカードで編集対象セクションを選ぶ。
 * (ダッシュボード/テーブル選択と同じカードの視覚言語)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-menu',
  template: `
    <div class="wrap">
      <div class="cards">
        @for (item of items(); track item.id) {
          <button class="card" type="button" (click)="itemSelected.emit(item.id)">
            <i class="card-icon ti ti-{{ item.icon }}" aria-hidden="true"></i>
            <span class="card-name">{{ item.name }}</span>
            <span class="card-desc">{{ item.description }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap {
      padding: 16px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
    }
    .card {
      font-family: inherit;
      text-align: left;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      padding: 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .card:hover {
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .card-icon {
      font-size: 24px;
      color: var(--tm-primary);
    }
    .card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
    }
    .card-desc {
      font-size: 11px;
      color: var(--tm-text-muted);
    }
  `,
})
export class SettingsMenu {
  /** 翻訳済みの項目をコンテナが渡す */
  readonly items = input<SettingsMenuItem[]>([]);

  readonly itemSelected = output<string>();
}
