import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

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
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="head">
            <span class="head-title">
              <i class="ti" [class]="mode() === 'create' ? 'ti ti-plus' : 'ti ti-pencil'" aria-hidden="true"></i>
              {{ mode() === 'create' ? '行の追加' : '行の編集' }}
            </span>
            <button class="close" type="button" (click)="cancelled.emit()" aria-label="閉じる">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>

          <div class="body">
            @if (errorMessage(); as msg) {
              <p class="error">{{ msg }}</p>
            }
            @for (col of columns(); track col.name) {
              <label class="field">
                <span class="label">
                  {{ col.name }}
                  @if (col.required && !col.readonly) {
                    <span class="req">必須</span>
                  }
                  @if (col.readonly) {
                    <span class="ro">読み取り専用</span>
                  }
                </span>
                @switch (col.type) {
                  @case ('bool') {
                    <input
                      type="checkbox"
                      class="check"
                      [checked]="asBool(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (change)="set(col.name, $any($event.target).checked)"
                    />
                  }
                  @case ('int') {
                    <input
                      type="number"
                      step="1"
                      class="input"
                      [value]="asText(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (input)="setNumber(col.name, $any($event.target).value)"
                    />
                  }
                  @case ('decimal') {
                    <input
                      type="number"
                      step="any"
                      class="input"
                      [value]="asText(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (input)="setNumber(col.name, $any($event.target).value)"
                    />
                  }
                  @case ('date') {
                    <input
                      type="date"
                      class="input"
                      [value]="asDate(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (input)="setText(col.name, $any($event.target).value)"
                    />
                  }
                  @case ('datetime') {
                    <input
                      type="datetime-local"
                      class="input"
                      [value]="asDateTime(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (input)="setText(col.name, $any($event.target).value)"
                    />
                  }
                  @default {
                    <input
                      type="text"
                      class="input"
                      [attr.maxlength]="col.maxLength ?? null"
                      [value]="asText(draft()[col.name])"
                      [disabled]="col.readonly || saving()"
                      (input)="setText(col.name, $any($event.target).value)"
                    />
                  }
                }
              </label>
            }
          </div>

          <div class="foot">
            @if (mode() === 'edit' && canDelete()) {
              <button class="btn danger" type="button" [disabled]="saving()" (click)="deleteClicked.emit()">
                <i class="ti ti-trash" aria-hidden="true"></i> 削除
              </button>
            }
            <span class="spacer"></span>
            <button class="btn" type="button" [disabled]="saving()" (click)="cancelled.emit()">
              キャンセル
            </button>
            <button class="btn primary" type="button" [disabled]="saving() || !canSave()" (click)="save()">
              {{ saving() ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(31, 35, 41, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog {
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tm-border);
    }
    .head-title {
      font-size: 14px;
      font-weight: 600;
    }
    .close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--tm-text-secondary);
      font-size: 16px;
    }
    .body {
      padding: 12px 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .error {
      margin: 0;
      padding: 8px 10px;
      background: var(--tm-danger-bg);
      color: var(--tm-danger);
      border-radius: var(--tm-radius);
      font-size: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .label {
      font-size: 12px;
      color: var(--tm-text-secondary);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .req {
      color: var(--tm-danger);
      font-size: 10px;
      border: 1px solid currentColor;
      border-radius: 3px;
      padding: 0 4px;
    }
    .ro {
      color: var(--tm-text-muted);
      font-size: 10px;
      border: 1px solid currentColor;
      border-radius: 3px;
      padding: 0 4px;
    }
    .input {
      height: 32px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      background: var(--tm-surface);
      color: var(--tm-text);
    }
    .input:disabled {
      background: var(--tm-surface-alt);
      color: var(--tm-text-muted);
    }
    .input:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .check {
      width: 16px;
      height: 16px;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--tm-border);
    }
    .spacer {
      flex: 1;
    }
    .btn {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      color: var(--tm-text);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .btn.primary {
      background: var(--tm-primary);
      border-color: var(--tm-primary);
      color: var(--tm-text-on-primary);
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--tm-primary-dark);
    }
    .btn.danger {
      background: var(--tm-surface);
      border-color: var(--tm-danger);
      color: var(--tm-danger);
    }
    .btn.danger:hover:not(:disabled) {
      background: var(--tm-danger-bg);
    }
  `,
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
