// features/table-maint — メタデータ駆動のテーブルメンテナンス画面(1テーブル分)。
//
// ルート /table-maint/:id で表示する。テーブルの選択はカード画面
// (table-select-container)が担い，ここは閲覧/検索/ページング + 行の
// 追加/編集/削除(1 操作ずつ batch API で即時反映。単一Tx・楽観ロック付き)。
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  ColumnDef,
  CsvExportChoice,
  CsvExportDialog,
  CsvExportDialogData,
  CsvMergeColumn,
  CsvMergeDialog,
  CsvMergeDialogData,
  CsvMergeRow,
  DataTablePage,
  EditColumn,
  FilterColumn,
  FilterPredicate,
  RowEditDialog,
  RowEditDialogData,
  TableRow,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import {
  confirmAsync,
  confirmThen,
  openModal,
  runDialogAction,
} from '../../core/dialog';
import { ConfirmsLeave } from '../../core/pending-changes.guard';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { buildCsv, downloadCsv, parseCsv } from '../../core/csv';
import { CsvImportRow, markConflicts, validateCsvRecords } from './csv-import';
import { Row, TableMeta } from '../../core/models';
import {
  blankRow,
  diffChanges,
  editableOnly,
  formatCell,
  pkOf,
  rowVersionOf,
} from './row-utils';

const PAGE_SIZE = 50;
/** 表示行に埋め込む元データ参照キー(列に無いので描画されない)。 */
const ROW_INDEX_KEY = '$i';
/** (*)行(DB 未反映の取込行)の参照キー。 */
const PENDING_INDEX_KEY = '$p';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-maint-container',
  imports: [
    DataTablePage,
  ],
  templateUrl: './table-maint-container.html',
  styleUrl: './table-maint-container.css',
})
export class TableMaintContainer implements ConfirmsLeave {
  protected readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private api = inject(TablesApi);
  private transloco = inject(TranslocoService);
  private dialogSvc = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  /** DB を実際に変更した操作の完了トースト(接続テストの結果表示と同じ見た目)。 */
  private toast(key: string, params?: Record<string, unknown>): void {
    this.snackBar.open(this.transloco.translate(key, params), undefined, {
      duration: 4000,
      panelClass: 'toast-ok',
    });
  }

  protected readonly pageSize = signal(PAGE_SIZE);

  protected readonly writable = computed(
    () =>
      this.auth.allows('table-maint', 'maintainer') &&
      (this.meta()?.writable ?? false),
  );

  protected readonly meta = signal<TableMeta | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  /** チップフィルタの述語(グリッドへ渡し,変更は onPredicatesChanged で受ける) */
  protected readonly predicates = signal<FilterPredicate[]>([]);
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
    }));
  });

  /** チップフィルタの対象列(対応外型 = readonly な非検索 string は除外)。 */
  protected readonly filterColumns = computed<FilterColumn[]>(() => {
    const m = this.meta();
    if (!m) return [];
    return m.columns
      .filter((c) => !(c.readonly && c.type === 'string' && !c.searchable))
      .map((c) => ({
        key: c.name,
        label: c.name,
        type: c.type as FilterColumn['type'],
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

  protected readonly saving = signal(false);
  /** 編集中の元 Row(削除/更新のキーと rowVersion 供給元)。 */
  private editingOriginal: Row | null = null;

  /** [CSV出力]押下時点のチェック行(表示行→元 Row に解決済み) */
  protected readonly csvSelection = signal<Row[]>([]);

  protected readonly mergeRows = signal<CsvImportRow[]>([]);
  /** DB 未反映の取込行((*)行)。メモリのみ(リロード/遷移で破棄) */
  protected readonly pendingRows = signal<CsvImportRow[]>([]);

  /**
   * マージ画面の列 = 取込に使う列のみ(readonly = IDENTITY 等の自動付与列は
   * insert に使われないため表示しない。CSV に含まれていても無視される)。
   */
  protected readonly mergeColumns = computed<CsvMergeColumn[]>(() =>
    (this.meta()?.columns ?? [])
      .filter((c) => !c.readonly)
      .map((c) => ({ key: c.name, label: c.name })),
  );

  /** 主キーが自動採番(readonly)のテーブルか(マージ画面の注記用) */
  protected readonly identityNote = computed(() => {
    const m = this.meta();
    if (!m) return false;
    return m.primaryKey.some(
      (pk) => m.columns.find((c) => c.name === pk)?.readonly,
    );
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
      await this.api.applyBatch(this.tableId, {
        inserts: targets.map((t) => t.parsed),
      });
      const saved = new Set(targets);
      this.pendingRows.update((rows) => rows.filter((r) => !saved.has(r)));
      await this.reload();
      this.toast('toasts.rowsSaved', { count: targets.length });
    } catch (err) {
      // batch は全ロールバック。重複キー等は何行目かを添えて表示する。
      const idx = (err as { error?: { details?: { index?: number } } })?.error
        ?.details?.index;
      let msg = apiErrorText(this.transloco, err, 'errors.saveFailed');
      if (typeof idx === 'number') {
        msg += this.transloco.translate('csvImport.rowSuffix', {
          line: idx + 1,
        });
      }
      this.errorMessage.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  /** 削除対象の元 Row(表示行の $i から解決済み) */
  private pendingBulkRows: Row[] = [];
  /** 削除対象の (*)行(ローカル破棄のみ) */
  private pendingBulkPending: CsvImportRow[] = [];

  constructor() {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.tableId = idParam ? Number(idParam) : 0;
    void this.init();
  }

  /**
   * 画面離脱の確認(canDeactivate: pendingChangesGuard から呼ばれる)。
   * (*)行は DB 未反映かつメモリのみのため,離脱すると黙って消える。
   * 残っている間は確認ダイアログを挟む。
   */
  confirmLeave(): boolean | Promise<boolean> {
    const count = this.pendingRows().length;
    if (count === 0) return true;
    return confirmAsync(this.dialogSvc, {
      title: this.transloco.translate('confirms.leavePendingTitle'),
      message: this.transloco.translate('confirms.leavePendingMessage', {
        count,
      }),
      confirmLabel: this.transloco.translate('confirms.leavePendingConfirm'),
      danger: true,
    });
  }

  /** リロード/タブを閉じる操作にはブラウザ標準の離脱確認を出す。 */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.pendingRows().length > 0) e.preventDefault();
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
      const size = this.pageSize();
      const page = await this.api.listRows(this.tableId, {
        limit: size,
        offset: (this.page() - 1) * size,
        preds: this.predicates(),
      });
      if (seq !== this.loadSeq) return; // 古い応答は捨てる
      this.rows.set(page.rows);
      this.total.set(page.total);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected onPredicatesChanged(preds: FilterPredicate[]): void {
    this.predicates.set(preds);
    this.page.set(1);
    this.errorMessage.set(null);
    void this.reload().catch((err) => {
      // 述語の検証エラー(型不正等)はバナーで通知する
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loadFailed'),
      );
    });
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
    this.openRowEditDialog('create', blankRow(this.meta()), null);
  }

  protected onRowSelected(display: TableRow): void {
    const i = display[ROW_INDEX_KEY];
    const original = typeof i === 'number' ? this.rows()[i] : undefined;
    if (!original) return;
    this.openRowEditDialog('edit', { ...original }, original);
  }

  private openRowEditDialog(
    mode: 'create' | 'edit',
    value: Row,
    original: Row | null,
  ): void {
    this.editingOriginal = original;
    const ref = openModal(
      this.dialogSvc,
      RowEditDialog,
      {
        mode,
        columns: this.editColumns(),
        value,
        canDelete: this.writable(),
      } satisfies RowEditDialogData,
      { width: '32rem', maxWidth: '95vw' },
    );
    // [複製]でダイアログ内が edit → create に切り替わるため，
    // 開いた時点の mode ではなく保存イベントの mode を使う。
    ref.componentInstance.saved.subscribe((r) => {
      void this.onSave(ref, r.mode, r.value);
    });
    ref.componentInstance.deleteClicked.subscribe(() => {
      this.askDelete(ref);
    });
  }

  protected async onSave(
    ref: MatDialogRef<RowEditDialog>,
    mode: 'create' | 'edit',
    draft: Row,
  ): Promise<void> {
    const m = this.meta();
    if (!m) return;
    await runDialogAction(this.transloco, ref, 'errors.saveFailed', async () => {
      // 変更なしで閉じただけの場合(編集で差分ゼロ)はトーストを出さない
      let mutated = true;
      if (mode === 'create') {
        await this.api.applyBatch(this.tableId, {
          inserts: [editableOnly(draft, m)],
        });
      } else {
        // mode: 'edit' は openRowEditDialog が editingOriginal を設定してから
        // 開くため常に非null(create/edit は同じダイアログ・同じ saved を共有)。
        const original = this.editingOriginal;
        if (!original) return;
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
        } else {
          mutated = false;
        }
      }
      this.editingOriginal = null;
      ref.close();
      await this.reload();
      if (mutated) {
        this.toast(mode === 'create' ? 'toasts.rowCreated' : 'toasts.rowUpdated');
      }
    });
  }

  protected askDelete(ref: MatDialogRef<RowEditDialog>): void {
    confirmThen(
      this.dialogSvc,
      {
        title: this.transloco.translate('confirms.deleteRowTitle'),
        message: this.transloco.translate('confirms.deleteRowMessage'),
        confirmLabel: this.transloco.translate('common.delete'),
        danger: true,
      },
      () => this.onDelete(ref),
    );
  }

  protected openCsvExport(selectedDisplayRows: TableRow[]): void {
    this.csvSelection.set(this.toOriginals(selectedDisplayRows));
    this.errorMessage.set(null);
    const ref = openModal(
      this.dialogSvc,
      CsvExportDialog,
      {
        selectionCount: this.csvSelection().length,
        pageCount: this.rows().length,
      } satisfies CsvExportDialogData,
      { width: '27.5rem', maxWidth: '95vw' },
    );
    ref.componentInstance.exported.subscribe((choice) => {
      void this.onCsvExport(ref, choice);
    });
  }

  protected async onCsvExport(
    ref: MatDialogRef<CsvExportDialog>,
    choice: CsvExportChoice,
  ): Promise<void> {
    const m = this.meta();
    if (!m) return;
    const filename = `${m.schemaName}.${m.tableName}.csv`;
    ref.componentRef?.setInput('busy', true);
    try {
      let text: string;
      if (choice.scope === 'all') {
        // 全件はサーバー側でストリーム生成(チップフィルタの述語を適用)。
        text = await this.api.exportCsvText(this.tableId, this.predicates());
      } else {
        const source =
          choice.scope === 'selection' ? this.csvSelection() : this.rows();
        text = this.rowsToCsv(source, m);
      }
      downloadCsv(filename, text, choice.excelCompat);
      ref.close();
    } catch (err) {
      ref.close();
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loadFailed'),
      );
    } finally {
      ref.componentRef?.setInput('busy', false);
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
    this.openMergeDialog(result.rows);
  }

  private openMergeDialog(rows: CsvImportRow[]): void {
    const ref = openModal(
      this.dialogSvc,
      CsvMergeDialog,
      {
        columns: this.mergeColumns(),
        rows,
        identityNote: this.identityNote(),
      } satisfies CsvMergeDialogData,
      { width: '56.25rem', maxWidth: '95vw' },
    );
    ref.componentInstance.applied.subscribe((appliedRows) => {
      this.onMergeApplied(ref, appliedRows);
    });
  }

  /** [適応]: 取込行を (*)行としてテーブル先頭に仮置き(DB 未反映)。 */
  protected onMergeApplied(
    ref: MatDialogRef<CsvMergeDialog>,
    rows: CsvMergeRow[],
  ): void {
    // CsvMergeDialog は入力配列の同一オブジェクトを返すため安全に絞り込める。
    const applied = this.mergeRows().filter((r) =>
      (rows as CsvImportRow[]).includes(r),
    );
    this.pendingRows.update((cur) => [...applied, ...cur]);
    ref.close();
  }

  /** チェックした行のまとめて削除(確認ダイアログを経由)。(*)行も選択可。 */
  protected askBulkDelete(displayRows: TableRow[]): void {
    const originals = this.toOriginals(displayRows);
    const pending = this.toPending(displayRows);
    if (originals.length + pending.length === 0) return;
    this.pendingBulkRows = originals;
    this.pendingBulkPending = pending;
    this.errorMessage.set(null);
    confirmThen(
      this.dialogSvc,
      {
        title: this.transloco.translate('confirms.bulkDeleteTitle'),
        message: this.transloco.translate('confirms.bulkDeleteMessage', {
          count: originals.length + pending.length,
        }),
        confirmLabel: this.transloco.translate('common.ok'),
        danger: true,
      },
      () => this.onBulkDelete(),
    );
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
      const count =
        this.pendingBulkRows.length + this.pendingBulkPending.length;
      const reloadNeeded = this.pendingBulkRows.length > 0;
      this.pendingBulkRows = [];
      this.pendingBulkPending = [];
      if (reloadNeeded) await this.reload();
      this.toast('toasts.rowsDeleted', { count });
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.deleteFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async onDelete(ref: MatDialogRef<RowEditDialog>): Promise<void> {
    const m = this.meta();
    const original = this.editingOriginal;
    if (!m || !original) return;
    await runDialogAction(this.transloco, ref, 'errors.deleteFailed', async () => {
      await this.api.applyBatch(this.tableId, {
        deletes: [
          { key: pkOf(original, m), rowVersion: rowVersionOf(original) },
        ],
      });
      this.editingOriginal = null;
      ref.close();
      await this.reload();
      this.toast('toasts.rowDeleted');
    });
  }
}
