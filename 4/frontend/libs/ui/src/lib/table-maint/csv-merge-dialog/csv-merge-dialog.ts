import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export interface CsvMergeColumn {
  key: string;
  label: string;
}

/** マージ画面の 1 行。conflict = フェッチ済み行と主キー重複(赤表示)。 */
export interface CsvMergeRow {
  /** 列名→セル文字列(表示用) */
  display: Record<string, string>;
  conflict: boolean;
  /** 型エラー理由(オレンジ表示。適応時に自動排除) */
  typeError?: string;
}

/** CsvMergeDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface CsvMergeDialogData {
  columns: CsvMergeColumn[];
  /** 精査済みの取込行 */
  rows: CsvMergeRow[];
  /** 主キーが自動採番(IDENTITY)のテーブルへの注記を出す */
  identityNote: boolean;
}

/**
 * CSV 取込のマージ画面(モーダル)。
 * - 赤 = フェッチ済み行と主キー重複 / オレンジ = 型エラー(ツールチップに理由)
 * - 行はクリックで選択,ドラッグで範囲選択
 * - [重複を排除] [選択行を排除] [適応](型エラー行は適応時に自動排除)
 * - 10,000 行対応のため table でなく grid + content-visibility で描画する
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-csv-merge-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './csv-merge-dialog.html',
  styleUrl: './csv-merge-dialog.css',
})
export class CsvMergeDialog {
  private readonly data = inject<CsvMergeDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CsvMergeDialog>>(MatDialogRef);

  protected readonly columns = this.data.columns;
  protected readonly identityNote = this.data.identityNote;

  readonly busy = input(false);

  /** [適応]。型エラー行を除いた残り(入力 rows と同一オブジェクト参照)を返す */
  readonly applied = output<CsvMergeRow[]>();

  /** 作業中の行(排除操作はここから消す) */
  protected readonly workRows = signal<CsvMergeRow[]>([...this.data.rows]);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());

  /** ドラッグ範囲選択の状態 */
  private dragging = false;
  private dragAnchor = 0;

  protected readonly conflictCount = computed(
    () => this.workRows().filter((r) => r.conflict).length,
  );
  protected readonly typeErrorCount = computed(
    () => this.workRows().filter((r) => r.typeError).length,
  );
  /** 適応で実際に取り込まれる行数(型エラーは自動排除) */
  protected readonly effectiveCount = computed(
    () => this.workRows().length - this.typeErrorCount(),
  );

  protected readonly colsStyle = computed(
    () => `repeat(${this.columns.length}, minmax(110px, 1fr))`,
  );

  protected onRowDown(index: number, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault(); // テキスト選択を抑止
    this.dragging = true;
    this.dragAnchor = index;
    // 単一クリック: その行だけ選択(既にその行だけが選択済みなら解除)
    const cur = this.selected();
    if (cur.size === 1 && cur.has(index)) {
      this.selected.set(new Set());
      this.dragging = false;
      return;
    }
    this.selected.set(new Set([index]));
  }

  protected onRowEnter(index: number): void {
    if (!this.dragging) return;
    const [from, to] =
      this.dragAnchor <= index
        ? [this.dragAnchor, index]
        : [index, this.dragAnchor];
    const next = new Set<number>();
    for (let i = from; i <= to; i++) next.add(i);
    this.selected.set(next);
  }

  @HostListener('document:pointerup')
  protected onPointerUp(): void {
    this.dragging = false;
  }

  protected removeConflicts(): void {
    this.workRows.update((rows) => rows.filter((r) => !r.conflict));
    this.selected.set(new Set());
  }

  protected removeSelected(): void {
    const sel = this.selected();
    this.workRows.update((rows) => rows.filter((_, i) => !sel.has(i)));
    this.selected.set(new Set());
  }

  protected apply(): void {
    if (this.busy()) return;
    this.applied.emit(this.workRows().filter((r) => !r.typeError));
  }

  protected cancel(): void {
    if (!this.busy()) {
      this.dialogRef.close();
    }
  }

  /** disableClose で Esc は無効化されているため,busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
