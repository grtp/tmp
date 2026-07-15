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
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    readonly: boolean;
    /** NOT NULL かつデフォルト値なし(除外すると新規行が作れなくなる) */
    required?: boolean;
  }[];
}

/** 列モード: 編集可 / 編集不可(表示のみ) / 除外(取得もしない)。 */
export type ColumnMode = 'edit' | 'readonly' | 'hidden';

/** 接続の選択肢(enabled のみをコンテナが渡す)。 */
export interface DialogConnection {
  id: number;
  name: string;
  /** スキーマ制限(空 = 制限なし)。設定時はスキーマ絞り込みを固定表示にする */
  schemaName?: string;
}

export interface ManagedTableRegistration {
  /** null = 既定接続 */
  connectionId: number | null;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
  /** 編集不可に指定した列名(自動判定の readonly は含まない) */
  readonlyColumns: string[];
  /** 管理対象外(除外)に指定した列名 */
  hiddenColumns: string[];
}

/** 編集モードの初期値(接続・実テーブルは固定表示)。 */
export interface ManagedTableEditValue {
  schemaName: string;
  tableName: string;
  /** 接続の表示名(既定DBは undefined) */
  connectionName?: string;
  displayName: string;
  description: string;
  readonlyColumns: string[];
  hiddenColumns: string[];
}

/** 監査系カラムの命名パターン。一致した列は「編集不可」を初期提案する。 */
const AUDIT_COLUMN_RE = /^(create|created|update|updated|insert|inserted|modify|modified)_?(at|on|by|user|date|time|datetime)$/i;

/**
 * 管理対象テーブルの登録/編集ダイアログ(admin)。
 * - create: 接続を選択 → 候補一覧(スキーマで絞り込み可) → カラムプレビュー → 登録
 * - edit  : 接続・実テーブルは固定表示。表示名/説明/列モードだけ変更できる
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-managed-table-dialog',
  imports: [TranslocoPipe],
  templateUrl: './managed-table-dialog.html',
  styleUrl: './managed-table-dialog.css',
})
export class ManagedTableDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集モードの初期値(open 時に取り込む) */
  readonly editValue = input<ManagedTableEditValue | null>(null);
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
  /** ユーザーが選んだ列モード(列名 -> mode)。プレビュー切替でリセット。 */
  protected readonly colModes = signal<Record<string, ColumnMode>>({});

  /** スキーマ絞り込みはクライアント側で行う(候補は接続単位で取得済み)。 */
  protected readonly filteredCandidates = computed(() => {
    const f = this.schemaFilter().trim().toLowerCase();
    if (!f) return this.candidates();
    return this.candidates().filter((t) => t.schemaName.toLowerCase().includes(f));
  });

  /** 選択中の接続がスキーマ制限付きなら、そのスキーマ名(絞り込み欄を固定・無効化する)。 */
  protected readonly lockedSchema = computed(() => {
    const id = this.connectionId();
    if (id === null) return undefined;
    const schema = this.connections().find((c) => c.id === id)?.schemaName;
    return schema || undefined;
  });

  protected readonly canConfirm = computed(() =>
    this.mode() === 'edit'
      ? this.displayName().trim() !== ''
      : this.selected() !== null && this.displayName().trim() !== '',
  );

  /** 除外に指定された NOT NULL・デフォルトなし列(新規行が作れなくなる警告)。 */
  protected readonly hiddenRequiredCols = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const modes = this.colModes();
    return p.columns
      .filter((c) => c.required && modes[c.name] === 'hidden')
      .map((c) => c.name);
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        const v = this.mode() === 'edit' ? this.editValue() : null;
        this.connectionId.set(null);
        this.schemaFilter.set('');
        this.selected.set(null);
        this.displayName.set(v?.displayName ?? '');
        this.description.set(v?.description ?? '');
        this.colModes.set({});
      }
    });
    // プレビューが変わったら列モードを初期化。
    // create: 監査系の命名(updated_at 等)は「編集不可」を初期提案
    // edit  : 登録済みの指定(readonlyColumns/hiddenColumns)を復元
    effect(() => {
      const p = this.preview();
      const init: Record<string, ColumnMode> = {};
      if (p) {
        const pk = new Set(p.primaryKey.map((n) => n.toLowerCase()));
        const v = this.mode() === 'edit' ? this.editValue() : null;
        const ro = new Set((v?.readonlyColumns ?? []).map((n) => n.toLowerCase()));
        const hd = new Set((v?.hiddenColumns ?? []).map((n) => n.toLowerCase()));
        for (const c of p.columns) {
          if (c.readonly || pk.has(c.name.toLowerCase())) continue;
          const key = c.name.toLowerCase();
          if (v) {
            init[c.name] = hd.has(key) ? 'hidden' : ro.has(key) ? 'readonly' : 'edit';
          } else {
            init[c.name] = AUDIT_COLUMN_RE.test(c.name) ? 'readonly' : 'edit';
          }
        }
      }
      this.colModes.set(init);
    });
  }

  protected isPk(name: string): boolean {
    const p = this.preview();
    return !!p && p.primaryKey.some((n) => n.toLowerCase() === name.toLowerCase());
  }

  protected modeOf(name: string): ColumnMode {
    return this.colModes()[name] ?? 'edit';
  }

  protected setMode(name: string, mode: string): void {
    this.colModes.update((m) => ({ ...m, [name]: mode as ColumnMode }));
  }

  protected connValue(): string {
    const id = this.connectionId();
    return id === null ? '' : String(id);
  }

  protected onConnChange(value: string): void {
    const id = value === '' ? null : Number(value);
    this.connectionId.set(id);
    this.selected.set(null);
    const schema = id === null ? undefined : this.connections().find((c) => c.id === id)?.schemaName;
    this.schemaFilter.set(schema || '');
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
    const v = this.mode() === 'edit' ? this.editValue() : null;
    const s = this.selected();
    if (!v && !s) return;
    const modes = this.colModes();
    const names = Object.keys(modes);
    this.confirmed.emit({
      connectionId: this.connectionId(),
      schemaName: v?.schemaName ?? s!.schemaName,
      tableName: v?.tableName ?? s!.tableName,
      displayName: this.displayName().trim(),
      description: this.description().trim() || undefined,
      readonlyColumns: names.filter((n) => modes[n] === 'readonly'),
      hiddenColumns: names.filter((n) => modes[n] === 'hidden'),
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.saving()) {
      this.cancelled.emit();
    }
  }
}
