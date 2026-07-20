import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** 選択肢としての管理対象テーブル。 */
export interface PickableTable {
  id: number;
  displayName: string;
  schemaName: string;
  tableName: string;
  /** 接続の表示名(既定DBは undefined) */
  connectionName?: string;
}

/**
 * テーブルカード用の管理対象テーブル選択ダイアログ。
 * ダッシュボードの(+)とテンプレートエディタから使う。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-pick-dialog',
  imports: [TranslocoPipe],
  templateUrl: './table-pick-dialog.html',
  styleUrl: './table-pick-dialog.css',
})
export class TablePickDialog {
  readonly open = input(false);
  readonly tables = input<PickableTable[]>([]);

  readonly tablePicked = output<PickableTable>();
  readonly cancelled = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
