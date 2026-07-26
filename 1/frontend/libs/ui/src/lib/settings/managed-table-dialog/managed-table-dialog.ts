import { MatIcon } from '@angular/material/icon';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
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

/**
 * 列モード: 編集可 / 編集不可(表示のみ) / 除外(取得もしない) / 固定値(自動セット)
 * / 除外+固定(画面には出さないが保存時に固定値を自動セット)。
 */
export type ColumnMode = 'edit' | 'readonly' | 'hidden' | 'fixed' | 'hiddenFixed';

/** 固定値列の指定(kind=literal は任意文字列，now は保存時のサーバー現在時刻)。 */
export interface FixedColumnSpec {
  name: string;
  kind: 'literal' | 'now';
  value?: string;
  /** 適用タイミング: 追加時のみ / 更新時のみ / 両方 */
  applyOn: 'insert' | 'update' | 'both';
}

/** 固定値のドラフト(列名は colModes 側が持つ)。 */
interface FixedDraft {
  kind: 'literal' | 'now';
  value: string;
  applyOn: 'insert' | 'update' | 'both';
}

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
  /** 固定値列(保存時にサーバーが自動セット) */
  fixedColumns: FixedColumnSpec[];
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
  fixedColumns: FixedColumnSpec[];
}

/** ManagedTableDialogData は開く側(コンテナ)が渡す起動時の固定値。 */
export interface ManagedTableDialogData {
  mode: 'create' | 'edit';
  editValue: ManagedTableEditValue | null;
  /** 選択可能な接続(enabled のみ)。既定DBは常に先頭の選択肢として表示される */
  connections: DialogConnection[];
}

/** 監査系カラムの命名パターン。一致した列は「編集不可」を初期提案する。 */
const AUDIT_COLUMN_RE =
  /^(create|created|update|updated|insert|inserted|modify|modified)_?(at|on|by|user|date|time|datetime)$/i;

/**
 * 管理対象テーブルの登録/編集ダイアログ(admin)。
 * - create: 接続を選択 → 候補一覧(スキーマで絞り込み可) → カラムプレビュー → 登録
 * - edit  : 接続・実テーブルは固定表示。表示名/説明/列モードだけ変更できる
 * 規約: 自分では API を呼ばず connectionChanged/candidateSelected/confirmed を
 * emit するだけ。candidates/preview/loading/saving/errorMessage はコンテナが
 * componentRef.setInput で更新する。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-managed-table-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './managed-table-dialog.html',
  styleUrl: './managed-table-dialog.css',
})
export class ManagedTableDialog {
  private readonly data = inject<ManagedTableDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ManagedTableDialog>>(MatDialogRef);

  protected readonly mode = this.data.mode;
  protected readonly editValue = this.data.editValue;
  protected readonly connections = this.data.connections;

  readonly candidates = input<CandidateTable[]>([]);
  readonly preview = input<CandidatePreview | null>(null);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  /** 接続の切替(null = 既定DB)。コンテナは候補一覧を再取得する */
  readonly connectionChanged = output<number | null>();
  readonly candidateSelected = output<{
    schemaName: string;
    tableName: string;
  }>();
  readonly confirmed = output<ManagedTableRegistration>();

  protected readonly connectionId = signal<number | null>(null);
  protected readonly schemaFilter = signal('');
  protected readonly selected = signal<CandidateTable | null>(null);
  protected readonly displayName = signal(this.data.editValue?.displayName ?? '');
  protected readonly description = signal(this.data.editValue?.description ?? '');
  /** ユーザーが選んだ列モード(列名 -> mode)。プレビュー切替でリセット。 */
  protected readonly colModes = signal<Record<string, ColumnMode>>({});
  /** 固定値の指定内容(列名 -> ドラフト)。mode='fixed' の列だけ意味を持つ。 */
  protected readonly fixedDrafts = signal<Record<string, FixedDraft>>({});

  /** スキーマ絞り込みはクライアント側で行う(候補は接続単位で取得済み)。 */
  protected readonly filteredCandidates = computed(() => {
    const f = this.schemaFilter().trim().toLowerCase();
    if (!f) return this.candidates();
    return this.candidates().filter((t) =>
      t.schemaName.toLowerCase().includes(f),
    );
  });

  /** 選択中の接続がスキーマ制限付きなら，そのスキーマ名(絞り込み欄を固定・無効化する)。 */
  protected readonly lockedSchema = computed(() => {
    const id = this.connectionId();
    if (id === null) return undefined;
    const schema = this.connections.find((c) => c.id === id)?.schemaName;
    return schema || undefined;
  });

  protected readonly canConfirm = computed(() => {
    const base =
      this.mode === 'edit'
        ? this.displayName().trim() !== ''
        : this.selected() !== null && this.displayName().trim() !== '';
    if (!base) return false;
    // 固定文字列を選んだ列は値が必須。
    const modes = this.colModes();
    const drafts = this.fixedDrafts();
    for (const name of Object.keys(modes)) {
      if (modes[name] !== 'fixed' && modes[name] !== 'hiddenFixed') continue;
      const d = drafts[name];
      if (!d || (d.kind === 'literal' && d.value.trim() === '')) return false;
    }
    return true;
  });

  /**
   * 除外に指定された NOT NULL・デフォルトなし列(新規行が作れなくなる警告)。
   * 除外+固定は追加時に値が自動セットされるなら対象外
   * (applyOn=update のみだと追加時に値が無いので警告する)。
   */
  protected readonly hiddenRequiredCols = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const modes = this.colModes();
    const drafts = this.fixedDrafts();
    return p.columns
      .filter((c) => {
        if (!c.required) return false;
        const m = modes[c.name];
        if (m === 'hidden') return true;
        return m === 'hiddenFixed' && drafts[c.name]?.applyOn === 'update';
      })
      .map((c) => c.name);
  });

  constructor() {
    // プレビューが変わったら列モードを初期化。
    // create: 監査系の命名(updated_at 等)は「編集不可」を初期提案
    // edit  : 登録済みの指定(readonly/hidden/fixed)を復元
    effect(() => {
      const p = this.preview();
      const init: Record<string, ColumnMode> = {};
      const drafts: Record<string, FixedDraft> = {};
      if (p) {
        const pk = new Set(p.primaryKey.map((n) => n.toLowerCase()));
        const v = this.mode === 'edit' ? this.editValue : null;
        const ro = new Set(
          (v?.readonlyColumns ?? []).map((n) => n.toLowerCase()),
        );
        const hd = new Set(
          (v?.hiddenColumns ?? []).map((n) => n.toLowerCase()),
        );
        const fx = new Map(
          (v?.fixedColumns ?? []).map(
            (f) => [f.name.toLowerCase(), f] as const,
          ),
        );
        for (const c of p.columns) {
          if (c.readonly || pk.has(c.name.toLowerCase())) continue;
          const key = c.name.toLowerCase();
          if (v) {
            const f = fx.get(key);
            if (f) {
              // 除外リストにも入っている固定値列は「除外+固定」として復元
              init[c.name] = hd.has(key) ? 'hiddenFixed' : 'fixed';
              drafts[c.name] = {
                kind: f.kind,
                value: f.value ?? '',
                applyOn: f.applyOn,
              };
            } else {
              init[c.name] = hd.has(key)
                ? 'hidden'
                : ro.has(key)
                  ? 'readonly'
                  : 'edit';
            }
          } else {
            init[c.name] = AUDIT_COLUMN_RE.test(c.name) ? 'readonly' : 'edit';
          }
        }
      }
      this.colModes.set(init);
      this.fixedDrafts.set(drafts);
    });
  }

  protected isPk(name: string): boolean {
    const p = this.preview();
    return (
      !!p && p.primaryKey.some((n) => n.toLowerCase() === name.toLowerCase())
    );
  }

  protected modeOf(name: string): ColumnMode {
    return this.colModes()[name] ?? 'edit';
  }

  protected setMode(name: string, mode: string): void {
    this.colModes.update((m) => ({ ...m, [name]: mode as ColumnMode }));
    // 固定値を選んだら既定ドラフト(固定文字列・追加/更新の両方)を用意する。
    if (mode === 'fixed' || mode === 'hiddenFixed') {
      this.fixedDrafts.update((d) =>
        d[name]
          ? d
          : { ...d, [name]: { kind: 'literal', value: '', applyOn: 'both' } },
      );
    }
  }

  protected fixedDraftOf(name: string): FixedDraft {
    return (
      this.fixedDrafts()[name] ?? {
        kind: 'literal',
        value: '',
        applyOn: 'both',
      }
    );
  }

  protected setFixedDraft(name: string, patch: Partial<FixedDraft>): void {
    this.fixedDrafts.update((d) => ({
      ...d,
      [name]: { ...this.fixedDraftOf(name), ...patch },
    }));
  }

  /** 現在時刻(now)を指定できる列型か(日付/日時/文字列のみ。バックエンドと同じ制約)。 */
  protected canUseNow(type: string): boolean {
    return type === 'date' || type === 'datetime' || type === 'string';
  }

  protected connValue(): string {
    const id = this.connectionId();
    return id === null ? '' : String(id);
  }

  protected onConnChange(value: string): void {
    const id = value === '' ? null : Number(value);
    this.connectionId.set(id);
    this.selected.set(null);
    const schema =
      id === null
        ? undefined
        : this.connections.find((c) => c.id === id)?.schemaName;
    this.schemaFilter.set(schema || '');
    this.connectionChanged.emit(id);
  }

  protected isSelected(t: CandidateTable): boolean {
    const s = this.selected();
    return (
      s !== null && s.schemaName === t.schemaName && s.tableName === t.tableName
    );
  }

  protected select(t: CandidateTable): void {
    this.selected.set(t);
    if (this.displayName().trim() === '') {
      this.displayName.set(t.tableName);
    }
    this.candidateSelected.emit({
      schemaName: t.schemaName,
      tableName: t.tableName,
    });
  }

  protected confirm(): void {
    const v = this.mode === 'edit' ? this.editValue : null;
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
      // 除外+固定は hiddenColumns と fixedColumns の両方に載せる
      // (バックエンドはこの組だけモードの併用を許可している)。
      hiddenColumns: names.filter(
        (n) => modes[n] === 'hidden' || modes[n] === 'hiddenFixed',
      ),
      fixedColumns: names
        .filter((n) => modes[n] === 'fixed' || modes[n] === 'hiddenFixed')
        .map((n) => {
          const d = this.fixedDraftOf(n);
          return {
            name: n,
            kind: d.kind,
            value: d.kind === 'literal' ? d.value : undefined,
            applyOn: d.applyOn,
          };
        }),
    });
  }

  protected cancel(): void {
    if (!this.saving()) {
      this.dialogRef.close();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
