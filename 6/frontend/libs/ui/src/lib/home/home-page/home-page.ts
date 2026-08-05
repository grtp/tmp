import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

import { HomeWidget, HomeWidgetView } from '../home-widget/home-widget';

/**
 * ホーム画面のウィジェットレンダラ。最大3コマのグリッドに size 分の幅で
 * 並べ,画面幅に応じて 3→2→1 コマに畳む。ウィジェット内部は
 * コンテナクエリで自身の幅に合わせる(tm-home-widget)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-home-page',
  imports: [HomeWidgetView],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  readonly widgets = input<HomeWidget[]>([]);
  /** ウィジェットが1つも無い時に出す文言(翻訳済みをコンテナが渡す) */
  readonly emptyText = input('');

  /** リンク押下。遷移方法(ルーター/新規タブ)はコンテナが決める。 */
  readonly linkOpened = output<string>();
}
