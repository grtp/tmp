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

/** 列メタデータ(バックエンドの ColumnMeta を写した表示用契約)。 */
export interface EditColumn {
  name: string;
  type: 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'uuid';
  nullable: boolean;
  readonly: boolean;
  required?: boolean;
  maxLength?: number;
  /** 主キー列(ID バッジ表示。編集モードでは入力不可) */
  primaryKey?: boolean;
  /** 固定値列(保存時にサーバーが自動セット。「自動」バッジ表示・入力不可) */
  fixed?: boolean;
}

export type EditValue = Record<string, unknown>;

/** RowEditDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface RowEditDialogData {
  mode: 'create' | 'edit';
  columns: EditColumn[];
  value: EditValue;
  canDelete: boolean;
}

/**
 * 行の追加/編集ダイアログ。
 * ColumnMeta の型に応じた入力コントロールを動的に描画する
 * (メタデータ駆動: テーブルが変わってもこのコンポーネントは変わらない)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-row-edit-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './row-edit-dialog.html',
  styleUrl: './row-edit-dialog.css',
})
export class RowEditDialog {
  private readonly data = inject<RowEditDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<RowEditDialog>>(MatDialogRef);

  protected readonly mode = this.data.mode;
  protected readonly columns = this.data.columns;
  protected readonly canDelete = this.data.canDelete;

  readonly errorMessage = input<string | null>(null);
  readonly saving = input(false);

  readonly saved = output<EditValue>();
  readonly deleteClicked = output<void>();

  protected readonly draft = signal<EditValue>({ ...this.data.value });

  protected readonly canSave = computed(() => {
    for (const c of this.columns) {
      if (!c.required || c.readonly || c.fixed) continue;
      const v = this.draft()[c.name];
      if (v === null || v === undefined || v === '') return false;
    }
    return true;
  });

  /**
   * 入力を無効化するか。readonly / 固定値列に加え，主キーは編集モードでは
   * 変更不可(更新キーは元の値で送られるため，変えても反映されない)。
   */
  protected isLocked(c: EditColumn): boolean {
    return (
      c.readonly || !!c.fixed || (!!c.primaryKey && this.mode === 'edit')
    );
  }

  protected set(name: string, v: unknown): void {
    this.draft.update((d) => ({ ...d, [name]: v }));
  }

  protected setText(name: string, v: string): void {
    this.set(name, v === '' ? null : v);
  }

  protected setNumber(name: string, v: string): void {
    this.set(name, v === '' ? null : Number(v));
  }

  protected save(): void {
    this.saved.emit(this.draft());
  }

  protected cancel(): void {
    if (!this.saving()) {
      this.dialogRef.close();
    }
  }

  /** disableClose で Esc は無効化されているため，busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }

  protected asText(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
  }

  protected asBool(v: unknown): boolean {
    return v === true;
  }

  /** ISO 8601 -> input[type=date] 用 "YYYY-MM-DD" */
  protected asDate(v: unknown): string {
    const s = this.asText(v);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  /** ISO 8601 -> input[type=datetime-local] 用 "YYYY-MM-DDTHH:mm" */
  protected asDateTime(v: unknown): string {
    const s = this.asText(v);
    return s.length >= 16 ? s.slice(0, 16) : s;
  }
}
