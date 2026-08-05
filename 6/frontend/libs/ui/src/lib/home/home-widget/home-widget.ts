import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** ウィジェットの横幅(グリッドのコマ数)。小=1 / 中=2 / 大=3。 */
export type HomeWidgetSize = 1 | 2 | 3;

/** リンク1件。url が `/` 始まりならアプリ内遷移,それ以外は外部リンク。 */
export interface HomeLinkItem {
  label: string;
  url: string;
  /** Material Symbols 名 */
  icon?: string;
  desc?: string;
  /** 機能コード。指定時,その権限(user 以上)が無いユーザーにはこの項目を出さない */
  requires?: string;
}

/**
 * ホームのウィジェット(表示用)。home-config(JSON)をコンテナが
 * 検証・権限フィルタした結果を受ける。JSON スキーマの正はコンテナ側の
 * パーサ(features/home/home-config.ts)。
 */
export type HomeWidget =
  | { type: 'hero'; size: HomeWidgetSize; title: string; subtitle?: string; links: HomeLinkItem[] }
  | { type: 'heading'; size: HomeWidgetSize; text: string }
  | { type: 'text'; size: HomeWidgetSize; text: string }
  | { type: 'note'; size: HomeWidgetSize; tone: 'info' | 'warn'; text: string }
  | { type: 'divider'; size: HomeWidgetSize }
  | { type: 'rows'; size: HomeWidgetSize; title?: string; items: HomeLinkItem[] }
  | { type: 'pills'; size: HomeWidgetSize; title?: string; items: HomeLinkItem[] }
  | { type: 'cards'; size: HomeWidgetSize; title?: string; items: HomeLinkItem[] };

/** 保存形式のウィジェット = 表示形 + 表示条件(権限)。ビルダーが編集する形。 */
export type HomeWidgetConfig = HomeWidget & {
  /** 機能コード。指定時,その機能の権限(user 以上)が無いユーザーには出さない */
  requires?: string;
};

/**
 * ウィジェット1個の描画。tm-home-page(閲覧)と tm-home-builder の
 * キャンバス(編集プレビュー)の両方から使う。グリッド配置(size の反映)は
 * 親側の責務。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-home-widget',
  imports: [MatIcon],
  templateUrl: './home-widget.html',
  styleUrl: './home-widget.css',
})
export class HomeWidgetView {
  readonly widget = input.required<HomeWidget>();

  /** リンク押下。遷移方法(ルーター/新規タブ)はコンテナが決める。 */
  readonly linkOpened = output<string>();

  // @switch では union が narrowing されないため,型ごとの computed で絞る
  // (該当しない型は null になり,テンプレートの @if が落とす)。
  private narrowed<T extends HomeWidget['type']>(type: T) {
    return computed(() => {
      const w = this.widget();
      return w.type === type ? (w as Extract<HomeWidget, { type: T }>) : null;
    });
  }
  protected readonly hero = this.narrowed('hero');
  protected readonly heading = this.narrowed('heading');
  protected readonly plainText = this.narrowed('text');
  protected readonly note = this.narrowed('note');
  protected readonly divider = this.narrowed('divider');
  protected readonly rows = this.narrowed('rows');
  protected readonly pills = this.narrowed('pills');
  protected readonly cards = this.narrowed('cards');

  protected isExternal(url: string): boolean {
    return !url.startsWith('/');
  }
}
