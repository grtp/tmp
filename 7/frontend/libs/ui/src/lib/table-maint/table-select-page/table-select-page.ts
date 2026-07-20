import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** カード1枚 = 管理対象テーブル。 */
export interface TableCard {
  id: number;
  displayName: string;
  schemaName: string;
  tableName: string;
  description?: string;
  /** 接続の表示名(既定DBは undefined) */
  connectionName?: string;
}

/**
 * テーブルメンテナンスの入口: 編集対象テーブルをカードで選ぶ。
 * (プルダウン選択の置き換え。ダッシュボードのカードと同じ視覚言語)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-select-page',
  imports: [TranslocoPipe],
  templateUrl: './table-select-page.html',
  styleUrl: './table-select-page.css',
})
export class TableSelectPage {
  readonly tables = input<TableCard[]>([]);
  readonly loading = input(false);

  /** カード選択(管理テーブル id を通知) */
  readonly tableSelected = output<number>();
}
