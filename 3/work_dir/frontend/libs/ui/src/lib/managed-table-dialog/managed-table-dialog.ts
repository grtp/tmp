import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

/** 登録候補(sys カタログ由来)。 */
export interface CandidateTable {
  schemaName: string;
  tableName: string;
  /** false のテーブルは選択不可(主キーが無い) */
  hasPrimaryKey: boolean;
}

/** 選択中テーブルのカラムプレビュー。 */
export interface CandidatePreview {
  primaryKey: string[];
  hasRowVersion: boolean;
  columns: { name: string; type: string; nullable: boolean; readonly: boolean }[];
}

export interface ManagedTableRegistration {
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
}

/**
 * 管理対象テーブルの登録ダイアログ(admin)。
 * 候補一覧から選択 → カラムプレビュー確認 → 表示名を付けて登録。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-managed-table-dialog',
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="head">
            <span class="head-title">
              <i class="ti ti-table-plus" aria-hidden="true"></i> 管理テーブルの登録
            </span>
            <button class="close" type="button" (click)="cancelled.emit()" aria-label="閉じる">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>

          <div class="body">
            @if (errorMessage(); as msg) {
              <p class="error">{{ msg }}</p>
            }

            <div class="columns2">
              <div class="pane">
                <p class="pane-title">候補テーブル</p>
                @if (loading()) {
                  <p class="muted">読み込み中…</p>
                } @else {
                  <ul class="candidates">
                    @for (t of candidates(); track t.schemaName + '.' + t.tableName) {
                      <li>
                        <button
                          class="cand"
                          type="button"
                          [class.selected]="isSelected(t)"
                          [disabled]="!t.hasPrimaryKey"
                          (click)="select(t)"
                        >
                          <span class="mono">{{ t.schemaName }}.{{ t.tableName }}</span>
                          @if (!t.hasPrimaryKey) {
                            <span class="nopk">PKなし</span>
                          }
                        </button>
                      </li>
                    } @empty {
                      <li class="muted">登録可能なテーブルがありません</li>
                    }
                  </ul>
                }
              </div>

              <div class="pane">
                <p class="pane-title">カラムプレビュー</p>
                @if (!selected()) {
                  <p class="muted">左の一覧からテーブルを選択してください</p>
                } @else if (!preview()) {
                  <p class="muted">読み込み中…</p>
                } @else {
                  <p class="pk">
                    PK: <span class="mono">{{ preview()!.primaryKey.join(', ') }}</span>
                    @if (preview()!.hasRowVersion) {
                      <span class="badge">rowversion</span>
                    }
                  </p>
                  <table class="cols">
                    <thead>
                      <tr><th>列名</th><th>型</th><th>NULL</th><th>編集</th></tr>
                    </thead>
                    <tbody>
                      @for (c of preview()!.columns; track c.name) {
                        <tr>
                          <td class="mono">{{ c.name }}</td>
                          <td>{{ c.type }}</td>
                          <td>{{ c.nullable ? '可' : '不可' }}</td>
                          <td>{{ c.readonly ? '-' : '○' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>

            <label class="field">
              <span class="label">表示名 <span class="req">必須</span></span>
              <input
                type="text"
                class="input"
                maxlength="128"
                [value]="displayName()"
                (input)="displayName.set($any($event.target).value)"
              />
            </label>
            <label class="field">
              <span class="label">説明</span>
              <input
                type="text"
                class="input"
                maxlength="400"
                [value]="description()"
                (input)="description.set($any($event.target).value)"
              />
            </label>
          </div>

          <div class="foot">
            <button class="btn" type="button" [disabled]="saving()" (click)="cancelled.emit()">
              キャンセル
            </button>
            <button class="btn primary" type="button" [disabled]="!canConfirm() || saving()" (click)="confirm()">
              {{ saving() ? '登録中…' : '登録' }}
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
      width: min(720px, calc(100vw - 32px));
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
    .columns2 {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      min-height: 200px;
    }
    .pane {
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 8px;
      overflow-y: auto;
      max-height: 260px;
    }
    .pane-title {
      margin: 0 0 6px;
      font-size: 11px;
      color: var(--tm-text-muted);
    }
    .candidates {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cand {
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      border-radius: var(--tm-radius);
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      color: var(--tm-text);
      display: flex;
      justify-content: space-between;
      gap: 6px;
    }
    .cand:hover:not(:disabled) {
      background: var(--tm-primary-tint-weak);
    }
    .cand.selected {
      background: var(--tm-primary-tint);
    }
    .cand:disabled {
      color: var(--tm-text-muted);
      cursor: default;
    }
    .nopk {
      font-size: 10px;
      color: var(--tm-danger);
    }
    .mono {
      font-family: var(--tm-font-mono);
    }
    .muted {
      color: var(--tm-text-muted);
      font-size: 12px;
    }
    .pk {
      font-size: 12px;
      margin: 0 0 6px;
    }
    .badge {
      font-size: 10px;
      background: var(--tm-primary-tint);
      color: var(--tm-primary);
      border-radius: 3px;
      padding: 1px 5px;
      margin-left: 6px;
    }
    .cols {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .cols th {
      text-align: left;
      color: var(--tm-text-muted);
      font-weight: 600;
      padding: 3px 6px;
      border-bottom: 1px solid var(--tm-border);
    }
    .cols td {
      padding: 3px 6px;
      border-bottom: 1px solid var(--tm-border);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .label {
      font-size: 12px;
      color: var(--tm-text-secondary);
    }
    .req {
      color: var(--tm-danger);
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
      color: var(--tm-text);
    }
    .input:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--tm-border);
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
  `,
})
export class ManagedTableDialog {
  readonly open = input(false);
  readonly candidates = input<CandidateTable[]>([]);
  readonly preview = input<CandidatePreview | null>(null);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly candidateSelected = output<{ schemaName: string; tableName: string }>();
  readonly confirmed = output<ManagedTableRegistration>();
  readonly cancelled = output<void>();

  protected readonly selected = signal<CandidateTable | null>(null);
  protected readonly displayName = signal('');
  protected readonly description = signal('');

  protected readonly canConfirm = computed(
    () => this.selected() !== null && this.displayName().trim() !== '',
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.selected.set(null);
        this.displayName.set('');
        this.description.set('');
      }
    });
  }

  protected isSelected(t: CandidateTable): boolean {
    const s = this.selected();
    return s !== null && s.schemaName === t.schemaName && s.tableName === t.tableName;
  }

  protected select(t: CandidateTable): void {
    this.selected.set(t);
    if (this.displayName().trim() === '') {
      this.displayName.set(t.tableName);
    }
    this.candidateSelected.emit({ schemaName: t.schemaName, tableName: t.tableName });
  }

  protected confirm(): void {
    const s = this.selected();
    if (!s) return;
    this.confirmed.emit({
      schemaName: s.schemaName,
      tableName: s.tableName,
      displayName: this.displayName().trim(),
      description: this.description().trim() || undefined,
    });
  }
}
