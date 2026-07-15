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
  templateUrl: './settings-menu.html',
  styleUrl: './settings-menu.css',
})
export class SettingsMenu {
  /** 翻訳済みの項目をコンテナが渡す */
  readonly items = input<SettingsMenuItem[]>([]);

  readonly itemSelected = output<string>();
}
