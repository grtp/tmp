import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { LangSelect } from '../lang-select/lang-select';
import { UserMenu } from '../user-menu/user-menu';

/**
 * サブ画面(テーブルメンテナンス/設定/履歴)共通のヘッダーバー。
 * タイトル押下でダッシュボードへ、ユーザー名押下でドロワー
 * (トップへ戻る / ログアウト)を開く。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-page-header',
  imports: [TranslocoPipe, LangSelect, UserMenu],
  templateUrl: './page-header.html',
  styleUrl: './page-header.css',
})
export class PageHeader {
  /** システム名(ブランド名のため翻訳しない) */
  readonly systemName = input('F-tool');
  readonly pageTitle = input('');
  readonly userName = input('');

  readonly backClicked = output<void>();
  /** タイトル押下 / ドロワーの[トップへ戻る] -> ダッシュボードへ */
  readonly homeClicked = output<void>();
  readonly logoutClicked = output<void>();
}
