// features/table-maint — メタデータ駆動のテーブルメンテナンス画面(1テーブル分)。
//
// ルート /table-maint/:id で表示する。テーブルの選択はカード画面
// (table-select-container)が担い，ここは閲覧/検索/ページング + 行の
// 追加/編集/削除(1 操作ずつ batch API で即時反映。単一Tx・楽観ロック付き)。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ColumnDef,
  ConfirmDialog,
  CsvExportChoice,
  CsvExportDialog,
  CsvMergeColumn,
  CsvMergeDialog,
  CsvMergeRow,
  DataTablePage,
  EditColumn,
  RowEditDialog,
  TableRow,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { buildCsv, downloadCsv, parseCsv } from '../../core/csv';
import { CsvImportRow, markConflicts, validateCsvRecords } from './csv-import';
import { ColumnMeta, Row, TableMeta } from '../../core/models';

const PAGE_SIZE = 50;
/** 表示行に埋め込む元データ参照キー(列に無いので描画されない)。 */
const ROW_INDEX_KEY = '$i';
/** (*)行(DB 未反映の取込行)の参照キー。 */
const PENDING_INDEX_KEY = '$p';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-maint-container',
  imports: [DataTablePage, RowEditDialog, ConfirmDialog, CsvExportDialog, CsvMergeDialog, TranslocoPipe],
  templateUrl: './table-maint-container.html',
  styleUrl: './table-maint-container.css',
})
export class TableMaintContainer {
  protected readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private api = inject(TablesApi);
  private transloco = inject(TranslocoService);

  protected readonly pageSize = signal(PAGE_SIZE);

  protected readonly writable = computed(
    () => this.auth.allows('table-maint', 'maintainer') && (this.meta()?.writable ?? false),
  );

  protected readonly meta = signal<TableMeta | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly total = signal(0);
  protected readonly totalIsCapped = signal(false);
  protected readonly page = signal(1);
  protected readonly filters = signal<Record<string, string>>({});
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  private tableId = 0;
  /** 応答順の逆転対策(古いレスポンスを捨てる)。 */
  private loadSeq = 0;

  /** ツールバーのラベル: 表示名 + 接続バッジ相当の文字列。 */
  protected readonly tableLabel = computed(() => {
    const m = this.meta();
    if (!m) return '';
    const conn = m.connectionName;
    return conn ? `${m.displayName} [${conn}]` : m.displayName;
  });

  /** 列幅の永続化キー(接続+テーブル単位)。 */
  protected readonly storageKey = computed(() => {
    const m = this.meta();
    if (!m) return '';
    return `ftool.colw:${m.connectionId ?? 0}:${m.schemaName}.${m.tableName}`;
  });

  protected readonly columnDefs = computed<ColumnDef[]>(() => {
    const m = this.meta();
    if (!m) return [];
    return m.columns.map((c) => ({
      key: c.name,
      label: c.name,
      mono: c.type === 'uuid' || m.primaryKey.includes(c.name),
      // フィルタ入力の種類: bool は選択，対応外型(readonly な string)は無効。
      filter: (c.type === 'bool'
        ? 'bool'
        : c.readonly && c.type === 'string' && !c.searchable
          ? 'none'
          : 'text') as ColumnDef['filter'],
    }));
  });

  /** API の Row -> 表示用(文字列/数値)へ整形。$i で元 Row を引けるようにする。 */
  protected readonly displayRows = computed<TableRow[]>(() =>
    this.rows().map((r, i) => {
      const out: TableRow = { [ROW_INDEX_KEY]: i };
      for (const c of this.meta()?.columns ?? []) {
        out[c.name] = formatCell(r[c.name], c.type);
      }
      return out;
    }),
  );

  protected readonly editColumns = computed<EditColumn[]>(() => {
    const m = this.meta();
    if (!m) return [];
    // 主キーはダイアログで ID バッジ表示(編集モードでは入力不可)。
    return m.columns.map((c) => ({
      ...c,
      primaryKey: m.primaryKey.includes(c.name),
    })) as EditColumn[];
  });

  protected readonly dialogOpen = signal(false);
  protected readonly dialogMode = signal<'create' | 'edit'>('create');
  protected readonly editValue = signal<Row>({});
  protected readonly dialogError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly confirmOpen = signal(false);
  /** 編集中の元 Row(削除/更新のキーと rowVersion 供給元)。 */
  private editingOriginal: Row | null = null;

  protected readonly csvExportOpen = signal(false);
  protected readonly csvBusy = signal(false);
  /** [CSV出力]押下時点のチェック行(表示行→元 Row に解決済み) */
  protected readonly csvSelection = signal<Row[]>([]);

  protected readonly mergeOpen = signal(false);
  protected readonly mergeRows = signal<CsvImportRow[]>([]);
  /** DB 未反映の取込行((*)行)。メモリのみ(リロード/遷移で破棄) */
  protected readonly pendingRows = signal<CsvImportRow[]>([]);

  /**
   * マージ画面の列 = 取込に使う列のみ(readonly = IDENTITY 等の自動付与列は
   * insert に使われないため表示しない。CSV に含まれていても無視される)。
   */
  protected readonly mergeColumns = computed<CsvMergeColumn[]>(
    () =>
      (this.meta()?.columns ?? [])
        .filter((c) => !c.readonly)
        .map((c) => ({ key: c.name, label: c.name })),
  );

  /** 主キーが自動採番(readonly)のテーブルか(マージ画面の注記用) */
  protected readonly identityNote = computed(() => {
    const m = this.meta();
    if (!m) return false;
    return m.primaryKey.some((pk) => m.columns.find((c) => c.name === pk)?.readonly);
  });

  /** (*)行の表示用(先頭に並ぶ。$p で元 CsvImportRow を引く)。 */
  protected readonly pendingDisplayRows = computed<TableRow[]>(() =>
    this.pendingRows().map((r, i) => {
      const out: TableRow = { [PENDING_INDEX_KEY]: i };
      for (const c of this.meta()?.columns ?? []) {
        out[c.name] = r.display[c.name] ?? '';
      }
      return out;
    }),
  );

  /** 表示行($p 付き)を pendingRows の元オブジェクトへ解決する。 */
  private toPending(displayRows: TableRow[]): CsvImportRow[] {
    const out: CsvImportRow[] = [];
    for (const d of displayRows) {
      const p = d[PENDING_INDEX_KEY];
      const row = typeof p === 'number' ? this.pendingRows()[p] : undefined;
      if (row) out.push(row);
    }
    return out;
  }

  /** [まとめて保存]: 選択された (*)行を単一 Tx で insert して DB へ反映。 */
  protected async onSavePending(displayRows: TableRow[]): Promise<void> {
    const m = this.meta();
    const targets = this.toPending(displayRows);
    if (!m || targets.length === 0) return;
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      await this.api.applyBatch(this.tableId, { inserts: targets.map((t) => t.parsed) });
      const saved = new Set(targets);
      this.pendingRows.update((rows) => rows.filter((r) => !saved.has(r)));
      await this.reload();
    } catch (err) {
      // batch は全ロールバック。重複キー等は何行目かを添えて表示する。
      const idx = (err as { error?: { details?: { index?: number } } })?.error?.details?.index;
      let msg = apiErrorText(this.transloco, err, 'errors.saveFailed');
      if (typeof idx === 'number') {
        msg += this.transloco.translate('csvImport.rowSuffix', { line: idx + 1 });
      }
      this.errorMessage.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly bulkConfirmOpen = signal(false);
  protected readonly pendingBulkCount = signal(0);
  /** 削除対象の元 Row(表示行の $i から解決済み) */
  private pendingBulkRows: Row[] = [];
  /** 削除対象の (*)行(ローカル破棄のみ) */
  private pendingBulkPending: CsvImportRow[] = [];

  constructor() {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.tableId = idParam ? Number(idParam) : 0;
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      this.meta.set(await this.api.getMeta(this.tableId));
      await this.reload();
    } catch {
      // 存在しない/権限なし/接続不可 -> カード一覧へ戻す
      this.router.navigate(['/table-maint']);
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const filters = this.filters();
      const size = this.pageSize();
      const page = await this.api.listRows(this.tableId, {
        limit: size,
        offset: (this.page() - 1) * size,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      if (seq !== this.loadSeq) return; // 古い応答は捨てる
      this.rows.set(page.rows);
      this.total.set(page.total);
      this.totalIsCapped.set(page.totalIsCapped ?? false);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected onFiltersChanged(filters: Record<string, string>): void {
    this.filters.set(filters);
    this.page.set(1);
    void this.reload();
  }

  protected async onPageChanged(p: number): Promise<void> {
    this.page.set(p);
    await this.reload();
  }

  protected async onPageSizeChanged(size: number): Promise<void> {
    this.pageSize.set(size);
    this.page.set(1);
    await this.reload();
  }

  protected onCreate(): void {
    if (!this.writable()) return;
    this.dialogMode.set('create');
    this.editingOriginal = null;
    this.editValue.set(blankRow(this.meta()));
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected onRowSelected(display: TableRow): void {
    const i = display[ROW_INDEX_KEY];
    const original = typeof i === 'number' ? this.rows()[i] : undefined;
    if (!original) return;
    this.dialogMode.set('edit');
    this.editingOriginal = original;
    this.editValue.set({ ...original });
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.editingOriginal = null;
  }

  protected async onSave(draft: Row): Promise<void> {
    const m = this.meta();
    if (!m) return;
    this.saving.set(true);
    this.dialogError.set(null);
    try {
      if (this.dialogMode() === 'create') {
        await this.api.applyBatch(this.tableId, { inserts: [editableOnly(draft, m)] });
      } else {
        const original = this.editingOriginal!;
        const changes = diffChanges(original, draft, m);
        if (Object.keys(changes).length > 0) {
          await this.api.applyBatch(this.tableId, {
            updates: [
              {
                key: pkOf(original, m),
                changes,
                rowVersion: rowVersionOf(original),
              },
            ],
          });
        }
      }
      this.closeDialog();
      await this.reload();
    } catch (err) {
      this.dialogError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected askDelete(): void {
    this.confirmOpen.set(true);
  }

  protected openCsvExport(selectedDisplayRows: TableRow[]): void {
    this.csvSelection.set(this.toOriginals(selectedDisplayRows));
    this.errorMessage.set(null);
    this.csvExportOpen.set(true);
  }

  protected async onCsvExport(choice: CsvExportChoice): Promise<void> {
    const m = this.meta();
    if (!m) return;
    const filename = `${m.schemaName}.${m.tableName}.csv`;
    this.csvBusy.set(true);
    try {
      let text: string;
      if (choice.scope === 'all') {
        // 全件はサーバー側でストリーム生成(列フィルタ適用)。
        const filters = this.filters();
        text = await this.api.exportCsvText(
          this.tableId,
          Object.keys(filters).length > 0 ? filters : undefined,
        );
      } else {
        const source = choice.scope === 'selection' ? this.csvSelection() : this.rows();
        text = this.rowsToCsv(source, m);
      }
      downloadCsv(filename, text, choice.excelCompat);
      this.csvExportOpen.set(false);
    } catch (err) {
      this.csvExportOpen.set(false);
      this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
    } finally {
      this.csvBusy.set(false);
    }
  }

  /** サーバー export と同じ表現で CSV 化(全列，$rowVersion 除外，date は YYYY-MM-DD)。 */
  private rowsToCsv(rows: Row[], m: TableMeta): string {
    const header = m.columns.map((c) => c.name);
    const body = rows.map((r) =>
      m.columns.map((c) => {
        const v = r[c.name];
        if (v === null || v === undefined) return '';
        if (c.type === 'date' && typeof v === 'string') return v.slice(0, 10);
        return v as string | number | boolean;
      }),
    );
    return buildCsv(header, body);
  }

  /** 表示行($i 付き)を元 Row の配列へ解決する。 */
  private toOriginals(displayRows: TableRow[]): Row[] {
    const out: Row[] = [];
    for (const d of displayRows) {
      const i = d[ROW_INDEX_KEY];
      const original = typeof i === 'number' ? this.rows()[i] : undefined;
      if (original) out.push(original);
    }
    return out;
  }

  /** CSV ファイルを精査してマージ画面を開く。形式エラーはバナーで中止。 */
  protected async onCsvFile(file: File): Promise<void> {
    const m = this.meta();
    if (!m) return;
    this.errorMessage.set(null);

    let text: string;
    try {
      text = await file.text();
    } catch {
      this.errorMessage.set(this.transloco.translate('csvImport.errRead'));
      return;
    }

    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(`csvImport.${key}`, params);
    const result = validateCsvRecords(parseCsv(text), m, {
      empty: t('errEmpty'),
      tooManyRows: t('errTooManyRows'),
      unknownColumn: (name) => t('errUnknownColumn', { name }),
      missingColumn: (name) => t('errMissingColumn', { name }),
      columnCount: (line) => t('errColumnCount', { line }),
      badCell: (column, reason) => t('errBadCell', { column, reason }),
      required: t('errRequired'),
      typeInt: t('errInt'),
      typeDecimal: t('errDecimal'),
      typeBool: t('errBool'),
      typeDate: t('errDate'),
      typeUuid: t('errUuid'),
    });
    if (!result.ok) {
      this.errorMessage.set(result.error);
      return;
    }

    // 重複判定は「フェッチ済みの行(現在ページ)」との主キー照合。
    markConflicts(result.rows, m, this.rows());
    this.mergeRows.set(result.rows);
    this.mergeOpen.set(true);
  }

  /** [適応]: 取込行を (*)行としてテーブル先頭に仮置き(DB 未反映)。 */
  protected onMergeApplied(rows: CsvMergeRow[]): void {
    // CsvMergeDialog は入力配列の同一オブジェクトを返すため安全に絞り込める。
    const applied = this.mergeRows().filter((r) => (rows as CsvImportRow[]).includes(r));
    this.pendingRows.update((cur) => [...applied, ...cur]);
    this.mergeOpen.set(false);
  }

  /** チェックした行のまとめて削除(確認ダイアログを経由)。(*)行も選択可。 */
  protected askBulkDelete(displayRows: TableRow[]): void {
    const originals = this.toOriginals(displayRows);
    const pending = this.toPending(displayRows);
    if (originals.length + pending.length === 0) return;
    this.pendingBulkRows = originals;
    this.pendingBulkPending = pending;
    this.pendingBulkCount.set(originals.length + pending.length);
    this.errorMessage.set(null);
    this.bulkConfirmOpen.set(true);
  }

  protected async onBulkDelete(): Promise<void> {
    const m = this.meta();
    if (!m) return;
    this.saving.set(true);
    try {
      // DB 行は単一 Tx で削除(1件でも失敗すれば全件ロールバック)。
      if (this.pendingBulkRows.length > 0) {
        await this.api.applyBatch(this.tableId, {
          deletes: this.pendingBulkRows.map((r) => ({
            key: pkOf(r, m),
            rowVersion: rowVersionOf(r),
          })),
        });
      }
      // (*)行は DB 未反映なのでローカル破棄のみ。
      if (this.pendingBulkPending.length > 0) {
        const drop = new Set(this.pendingBulkPending);
        this.pendingRows.update((rows) => rows.filter((r) => !drop.has(r)));
      }
      this.bulkConfirmOpen.set(false);
      const reloadNeeded = this.pendingBulkRows.length > 0;
      this.pendingBulkRows = [];
      this.pendingBulkPending = [];
      if (reloadNeeded) await this.reload();
    } catch (err) {
      this.bulkConfirmOpen.set(false);
      this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.deleteFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async onDelete(): Promise<void> {
    const m = this.meta();
    const original = this.editingOriginal;
    if (!m || !original) return;
    this.saving.set(true);
    try {
      await this.api.applyBatch(this.tableId, {
        deletes: [{ key: pkOf(original, m), rowVersion: rowVersionOf(original) }],
      });
      this.confirmOpen.set(false);
      this.closeDialog();
      await this.reload();
    } catch (err) {
      this.confirmOpen.set(false);
      this.dialogError.set(apiErrorText(this.transloco, err, 'errors.deleteFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}

function formatCell(v: unknown, type?: ColumnMeta['type']): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? '○' : '-';
  // datetime は ISO のまま(2026-07-18T19:52:47.9180829Z)だと読みにくいので
  // "yyyy-mm-dd hh:mm:ss.ffffff" 形式へ(値の変換はしない: T→空白，末尾Zを除去)。
  if (type === 'datetime' && typeof v === 'string' && v.length >= 19) {
    return v.replace('T', ' ').replace(/Z$/, '');
  }
  return String(v);
}

function blankRow(meta: TableMeta | null): Row {
  const out: Row = {};
  for (const c of meta?.columns ?? []) {
    if (!c.readonly) out[c.name] = c.type === 'bool' ? false : null;
  }
  return out;
}

/** readonly 列と予約キーを除いた insert ボディを作る。 */
function editableOnly(draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    out[c.name] = draft[c.name] ?? null;
  }
  return out;
}

/** 変更された編集可能列だけを changes に畳み込む。 */
function diffChanges(original: Row, draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    const before = original[c.name] ?? null;
    const after = draft[c.name] ?? null;
    if (before !== after) out[c.name] = after;
  }
  return out;
}

function pkOf(row: Row, meta: TableMeta): Row {
  const key: Row = {};
  for (const pk of meta.primaryKey) key[pk] = row[pk];
  return key;
}

/** rowversion は予約キー $rowVersion で行に同梱される。 */
function rowVersionOf(row: Row): string | undefined {
  const v = row['$rowVersion'];
  return typeof v === 'string' ? v : undefined;
}
