import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

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

/** 接続の選択肢(enabled のみをコンテナが渡す)。 */
export interface DialogConnection {
  id: number;
  name: string;
}

export interface ManagedTableRegistration {
  /** null = 既定接続 */
  connectionId: number | null;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
}

/**
 * 管理対象テーブルの登録ダイアログ(admin)。
 * 接続を選択 → 候補一覧(スキーマで絞り込み可) → カラムプレビュー → 登録。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-managed-table-dialog',
  imports: [TranslocoPipe],
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="head">
            <span class="head-title">
              <i class="ti ti-table-plus" aria-hidden="true"></i>
              {{ 'managedTableDialog.title' | transloco }}
            </span>
            <button class="close" type="button" (click)="cancelled.emit()" [attr.aria-label]="'common.close' | transloco">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>

          <div class="body">
            @if (errorMessage(); as msg) {
              <p class="error">{{ msg }}</p>
            }

            <div class="filters">
              <label class="filter">
                <span class="label">{{ 'managedTableDialog.connection' | transloco }}</span>
                <select class="select" [value]="connValue()" (change)="onConnChange($any($event.target).value)">
                  <option value="">{{ 'common.defaultDb' | transloco }}</option>
                  @for (cn of connections(); track cn.id) {
                    <option [value]="cn.id">{{ cn.name }}</option>
                  }
                </select>
              </label>
              <label class="filter grow">
                <span class="label">{{ 'managedTableDialog.schemaFilter' | transloco }}</span>
                <input class="input" type="search" [value]="schemaFilter()"
                  (input)="schemaFilter.set($any($event.target).value)" />
              </label>
            </div>

            <div class="columns2">
              <div class="pane">
                <p class="pane-title">{{ 'managedTableDialog.candidates' | transloco }}</p>
                @if (loading()) {
                  <p class="muted">{{ 'common.loading' | transloco }}</p>
                } @else {
                  <ul class="candidates">
                    @for (t of filteredCandidates(); track t.schemaName + '.' + t.tableName) {
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
                            <span class="nopk">{{ 'managedTableDialog.noPk' | transloco }}</span>
                          }
                        </button>
                      </li>
                    } @empty {
                      <li class="muted">{{ 'managedTableDialog.noCandidates' | transloco }}</li>
                    }
                  </ul>
                }
              </div>

              <div class="pane">
                <p class="pane-title">{{ 'managedTableDialog.preview' | transloco }}</p>
                @if (!selected()) {
                  <p class="muted">{{ 'managedTableDialog.selectPrompt' | transloco }}</p>
                } @else if (!preview()) {
                  <p class="muted">{{ 'common.loading' | transloco }}</p>
                } @else {
                  <p class="pk">
                    {{ 'managedTableDialog.pk' | transloco }}:
                    <span class="mono">{{ preview()!.primaryKey.join(', ') }}</span>
                    @if (preview()!.hasRowVersion) {
                      <span class="badge">rowversion</span>
                    }
                  </p>
                  <table class="cols">
                    <thead>
                      <tr>
                        <th>{{ 'managedTableDialog.colName' | transloco }}</th>
                        <th>{{ 'managedTableDialog.colType' | transloco }}</th>
                        <th>{{ 'managedTableDialog.colNull' | transloco }}</th>
                        <th>{{ 'managedTableDialog.colEdit' | transloco }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of preview()!.columns; track c.name) {
                        <tr>
                          <td class="mono">{{ c.name }}</td>
                          <td>{{ c.type }}</td>
                          <td>{{ (c.nullable ? 'managedTableDialog.nullableYes' : 'managedTableDialog.nullableNo') | transloco }}</td>
                          <td>{{ c.readonly ? '-' : '○' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>

            <label class="field">
              <span class="label">
                {{ 'managedTableDialog.displayName' | transloco }}
                <span class="req">{{ 'common.required' | transloco }}</span>
              </span>
              <input
                type="text"
                class="input"
                maxlength="128"
                [value]="displayName()"
                (input)="displayName.set($any($event.target).value)"
              />
            </label>
            <label class="field">
              <span class="label">{{ 'managedTableDialog.description' | transloco }}</span>
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
              {{ 'common.cancel' | transloco }}
            </button>
            <button class="btn primary" type="button" [disabled]="!canConfirm() || saving()" (click)="confirm()">
              {{ (saving() ? 'managedTableDialog.registering' : 'managedTableDialog.register') | transloco }}
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
      width: min(760px, calc(100vw - 32px));
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
    .filters {
      display: flex;
      gap: 12px;
    }
    .filter {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .filter.grow {
      flex: 1;
    }
    .select {
      height: 32px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      background: var(--tm-surface);
      color: var(--tm-text);
      min-width: 180px;
    }
    .columns2 {
      display: grid;
      grid-template-columns: 260px 1fr;
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
  /** 選択可能な接続(enabled のみ)。既定DBは常に先頭の選択肢として表示される */
  readonly connections = input<DialogConnection[]>([]);
  readonly candidates = input<CandidateTable[]>([]);
  readonly preview = input<CandidatePreview | null>(null);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  /** 接続の切替(null = 既定DB)。コンテナは候補一覧を再取得する */
  readonly connectionChanged = output<number | null>();
  readonly candidateSelected = output<{ schemaName: string; tableName: string }>();
  readonly confirmed = output<ManagedTableRegistration>();
  readonly cancelled = output<void>();

  protected readonly connectionId = signal<number | null>(null);
  protected readonly schemaFilter = signal('');
  protected readonly selected = signal<CandidateTable | null>(null);
  protected readonly displayName = signal('');
  protected readonly description = signal('');

  /** スキーマ絞り込みはクライアント側で行う(候補は接続単位で取得済み)。 */
  protected readonly filteredCandidates = computed(() => {
    const f = this.schemaFilter().trim().toLowerCase();
    if (!f) return this.candidates();
    return this.candidates().filter((t) => t.schemaName.toLowerCase().includes(f));
  });

  protected readonly canConfirm = computed(
    () => this.selected() !== null && this.displayName().trim() !== '',
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.connectionId.set(null);
        this.schemaFilter.set('');
        this.selected.set(null);
        this.displayName.set('');
        this.description.set('');
      }
    });
  }

  protected connValue(): string {
    const id = this.connectionId();
    return id === null ? '' : String(id);
  }

  protected onConnChange(value: string): void {
    const id = value === '' ? null : Number(value);
    this.connectionId.set(id);
    this.selected.set(null);
    this.connectionChanged.emit(id);
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
      connectionId: this.connectionId(),
      schemaName: s.schemaName,
      tableName: s.tableName,
      displayName: this.displayName().trim(),
      description: this.description().trim() || undefined,
    });
  }
}
