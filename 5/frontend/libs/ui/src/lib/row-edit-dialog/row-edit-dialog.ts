import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
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
}

export type EditValue = Record<string, unknown>;

/**
 * 行の追加/編集ダイアログ。
 * ColumnMeta の型に応じた入力コントロールを動的に描画する
 * (メタデータ駆動: テーブルが変わってもこのコンポーネントは変わらない)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-row-edit-dialog',
  imports: [TranslocoPipe],
  templateUrl: './row-edit-dialog.html',
  styleUrl: './row-edit-dialog.css',
})
export class RowEditDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly columns = input<EditColumn[]>([]);
  /** 編集対象の初期値(mode=edit)。open が true になった時点の値を取り込む。 */
  readonly value = input<EditValue>({});
  readonly errorMessage = input<string | null>(null);
  readonly saving = input(false);
  readonly canDelete = input(false);

  readonly saved = output<EditValue>();
  readonly deleteClicked = output<void>();
  readonly cancelled = output<void>();

  protected readonly draft = signal<EditValue>({});

  protected readonly canSave = computed(() => {
    for (const c of this.columns()) {
      if (!c.required || c.readonly) continue;
      const v = this.draft()[c.name];
      if (v === null || v === undefined || v === '') return false;
    }
    return true;
  });

  constructor() {
    // open のたびに value を draft に取り込む(開いている間は draft が正)。
    effect(() => {
      if (this.open()) {
        this.draft.set({ ...this.value() });
      }
    });
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

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.saving()) {
      this.cancelled.emit();
    }
  }

  // ------------------------------------------------- 表示用フォーマッタ

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
