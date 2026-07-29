import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  output,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
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

/** TablePickDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface TablePickDialogData {
  tables: PickableTable[];
}

/**
 * テーブルカード用の管理対象テーブル選択ダイアログ。
 * ダッシュボードの(+)とテンプレートエディタから使う。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-pick-dialog',
  imports: [MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './table-pick-dialog.html',
  styleUrl: './table-pick-dialog.css',
})
export class TablePickDialog {
  private readonly data = inject<TablePickDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TablePickDialog>>(MatDialogRef);

  protected readonly tables = this.data.tables;

  readonly tablePicked = output<PickableTable>();

  protected cancel(): void {
    this.dialogRef.close();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
