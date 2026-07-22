import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** 出力スコープ。excelCompat は BOM 付与の有無。 */
export interface CsvExportChoice {
  scope: 'selection' | 'page' | 'all';
  excelCompat: boolean;
}

/** CsvExportDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface CsvExportDialogData {
  /** 選択中の行数(0 なら[選択範囲出力]を無効化) */
  selectionCount: number;
  /** 表示中の行数(表示範囲出力のヒント表示用) */
  pageCount: number;
}

/**
 * CSV 出力ダイアログ。
 * [Excel互換]チェック + [選択範囲出力][表示範囲出力][全件出力]。
 * 選択範囲は選択行が無ければ無効。出力実行はコンテナの責務。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-csv-export-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './csv-export-dialog.html',
  styleUrl: './csv-export-dialog.css',
})
export class CsvExportDialog {
  private readonly data = inject<CsvExportDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CsvExportDialog>>(MatDialogRef);

  protected readonly selectionCount = this.data.selectionCount;
  protected readonly pageCount = this.data.pageCount;

  readonly busy = input(false);

  readonly exported = output<CsvExportChoice>();

  /** Excel 互換(UTF-8 BOM 付き)で出力するか */
  protected readonly excelCompat = signal(false);

  protected choose(scope: CsvExportChoice['scope']): void {
    if (this.busy()) return;
    this.exported.emit({ scope, excelCompat: this.excelCompat() });
  }

  protected cancel(): void {
    if (!this.busy()) {
      this.dialogRef.close();
    }
  }

  /** disableClose で Esc は無効化されているため，busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
