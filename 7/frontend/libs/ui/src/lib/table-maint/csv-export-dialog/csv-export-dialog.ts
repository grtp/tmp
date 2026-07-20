import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
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

/**
 * CSV 出力ダイアログ。
 * [Excel互換]チェック + [選択範囲出力][表示範囲出力][全件出力]。
 * 選択範囲は選択行が無ければ無効。出力実行はコンテナの責務。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-csv-export-dialog',
  imports: [TranslocoPipe],
  templateUrl: './csv-export-dialog.html',
  styleUrl: './csv-export-dialog.css',
})
export class CsvExportDialog {
  readonly open = input(false);
  /** 選択中の行数(0 なら[選択範囲出力]を無効化) */
  readonly selectionCount = input(0);
  /** 表示中の行数(表示範囲出力のヒント表示用) */
  readonly pageCount = input(0);
  readonly busy = input(false);

  readonly exported = output<CsvExportChoice>();
  readonly cancelled = output<void>();

  /** Excel 互換(UTF-8 BOM 付き)で出力するか */
  protected readonly excelCompat = signal(false);

  protected choose(scope: CsvExportChoice['scope']): void {
    if (this.busy()) return;
    this.exported.emit({ scope, excelCompat: this.excelCompat() });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.busy()) {
      this.cancelled.emit();
    }
  }
}
