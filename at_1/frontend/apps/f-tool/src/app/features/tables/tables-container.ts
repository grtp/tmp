import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal, } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ColumnDef, CsvExportChoice, CsvExportDialog, CsvExportDialogData, CsvMergeColumn, CsvMergeDialog, CsvMergeDialogData, CsvMergeRow, DataTablePage, EditColumn, FilterColumn, FilterPredicate, RowEditDialog, RowEditDialogData, TableRow, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { confirmAsync, confirmThen, openModal, runDialogAction, } from '../../core/dialog';
import { ConfirmsLeave } from '../../core/pending-changes.guard';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { buildCsv, downloadCsv, parseCsv } from '../../core/csv';
import { CsvImportRow, markConflicts, validateCsvRecords } from './csv-import';
import { Row, TableMeta } from '../../core/models';
import { blankRow, diffChanges, editableOnly, formatCell, pkOf, rowVersionOf, } from './row-utils';
const PAGE_SIZE = 50;
const ROW_INDEX_KEY = '$i';
const PENDING_INDEX_KEY = '$p';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-tables-container',
    imports: [
        DataTablePage,
    ],
    templateUrl: './tables-container.html',
    styleUrl: './tables-container.css',
})
export class TablesContainer implements ConfirmsLeave {
    protected readonly router = inject(Router);
    private route = inject(ActivatedRoute);
    private auth = inject(AuthService);
    private api = inject(TablesApi);
    private transloco = inject(TranslocoService);
    private dialogSvc = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private toast(key: string, params?: Record<string, unknown>): void {
        this.snackBar.open(this.transloco.translate(key, params), undefined, {
            duration: 4000,
            panelClass: 'toast-ok',
        });
    }
    protected readonly pageSize = signal(PAGE_SIZE);
    protected readonly writable = computed(() => this.auth.allows('tables', 'maintainer') &&
        (this.meta()?.writable ?? false));
    protected readonly meta = signal<TableMeta | null>(null);
    protected readonly rows = signal<Row[]>([]);
    protected readonly total = signal(0);
    protected readonly page = signal(1);
    protected readonly predicates = signal<FilterPredicate[]>([]);
    protected readonly loading = signal(true);
    protected readonly errorMessage = signal<string | null>(null);
    private tableId = 0;
    private readonly idParam: string;
    private loadSeq = 0;
    protected readonly tableLabel = computed(() => {
        const m = this.meta();
        if (!m)
            return '';
        const conn = m.connectionName;
        return conn ? `${m.displayName} [${conn}]` : m.displayName;
    });
    protected readonly storageKey = computed(() => {
        const m = this.meta();
        if (!m)
            return '';
        return `ftool.colw:${m.connectionId ?? 0}:${m.schemaName}.${m.tableName}`;
    });
    protected readonly columnDefs = computed<ColumnDef[]>(() => {
        const m = this.meta();
        if (!m)
            return [];
        return m.columns.map((c) => {
            const numeric = c.type === 'int' || c.type === 'decimal';
            return {
                key: c.name,
                label: c.name,
                mono: numeric || c.type === 'uuid' || m.primaryKey.includes(c.name),
                align: numeric ? ('right' as const) : undefined,
                sortable: true,
            };
        });
    });
    protected readonly sortKey = signal<string | null>(null);
    protected readonly sortDir = signal<'asc' | 'desc'>('asc');
    protected async onSortChanged(e: {
        key: string;
        dir: 'asc' | 'desc';
    }): Promise<void> {
        this.sortKey.set(e.key);
        this.sortDir.set(e.dir);
        this.page.set(1);
        await this.reload();
    }
    protected async onSortCleared(): Promise<void> {
        this.sortKey.set(null);
        this.page.set(1);
        await this.reload();
    }
    protected readonly filterColumns = computed<FilterColumn[]>(() => {
        const m = this.meta();
        if (!m)
            return [];
        return m.columns
            .filter((c) => !(c.readonly && c.type === 'string' && !c.searchable))
            .map((c) => ({
            key: c.name,
            label: c.name,
            type: c.type as FilterColumn['type'],
        }));
    });
    protected readonly displayRows = computed<TableRow[]>(() => this.rows().map((r, i) => {
        const out: TableRow = { [ROW_INDEX_KEY]: i };
        for (const c of this.meta()?.columns ?? []) {
            out[c.name] = formatCell(r[c.name], c.type);
        }
        return out;
    }));
    protected readonly editColumns = computed<EditColumn[]>(() => {
        const m = this.meta();
        if (!m)
            return [];
        return m.columns.map((c) => ({
            ...c,
            primaryKey: m.primaryKey.includes(c.name),
        })) as EditColumn[];
    });
    protected readonly saving = signal(false);
    private editingOriginal: Row | null = null;
    protected readonly csvSelection = signal<Row[]>([]);
    protected readonly mergeRows = signal<CsvImportRow[]>([]);
    protected readonly pendingRows = signal<CsvImportRow[]>([]);
    protected readonly mergeColumns = computed<CsvMergeColumn[]>(() => (this.meta()?.columns ?? [])
        .filter((c) => !c.readonly)
        .map((c) => ({ key: c.name, label: c.name })));
    protected readonly identityNote = computed(() => {
        const m = this.meta();
        if (!m)
            return false;
        return m.primaryKey.some((pk) => m.columns.find((c) => c.name === pk)?.readonly);
    });
    protected readonly pendingDisplayRows = computed<TableRow[]>(() => this.pendingRows().map((r, i) => {
        const out: TableRow = { [PENDING_INDEX_KEY]: i };
        for (const c of this.meta()?.columns ?? []) {
            out[c.name] = r.display[c.name] ?? '';
        }
        return out;
    }));
    private toPending(displayRows: TableRow[]): CsvImportRow[] {
        const out: CsvImportRow[] = [];
        for (const d of displayRows) {
            const p = d[PENDING_INDEX_KEY];
            const row = typeof p === 'number' ? this.pendingRows()[p] : undefined;
            if (row)
                out.push(row);
        }
        return out;
    }
    protected async onSavePending(displayRows: TableRow[]): Promise<void> {
        const m = this.meta();
        const targets = this.toPending(displayRows);
        if (!m || targets.length === 0)
            return;
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
        }
        catch (err) {
            const idx = (err as {
                error?: {
                    details?: {
                        index?: number;
                    };
                };
            })?.error
                ?.details?.index;
            let msg = apiErrorText(this.transloco, err, 'errors.saveFailed');
            if (typeof idx === 'number') {
                msg += this.transloco.translate('csvImport.rowSuffix', {
                    line: idx + 1,
                });
            }
            this.errorMessage.set(msg);
        }
        finally {
            this.saving.set(false);
        }
    }
    private pendingBulkRows: Row[] = [];
    private pendingBulkPending: CsvImportRow[] = [];
    constructor() {
        this.idParam = this.route.snapshot.paramMap.get('id') ?? '';
        void this.init();
    }
    confirmLeave(): boolean | Promise<boolean> {
        const count = this.pendingRows().length;
        if (count === 0)
            return true;
        return confirmAsync(this.dialogSvc, {
            title: this.transloco.translate('confirms.leavePendingTitle'),
            message: this.transloco.translate('confirms.leavePendingMessage', {
                count,
            }),
            confirmLabel: this.transloco.translate('confirms.leavePendingConfirm'),
            danger: true,
        });
    }
    @HostListener('window:beforeunload', ['$event'])
    protected onBeforeUnload(e: BeforeUnloadEvent): void {
        if (this.pendingRows().length > 0)
            e.preventDefault();
    }
    private async init(): Promise<void> {
        this.loading.set(true);
        try {
            this.tableId = await this.resolveTableId();
            this.meta.set(await this.api.getMeta(this.tableId));
            await this.reload();
        }
        catch {
            this.router.navigate(['/tables']);
        }
        finally {
            this.loading.set(false);
        }
    }
    private async resolveTableId(): Promise<number> {
        const slug = this.idParam.toLowerCase();
        const tables = await this.api.listTables();
        const hit = tables.find((t) => t.slug.toLowerCase() === slug);
        if (!hit)
            throw new Error(`unknown table slug: ${this.idParam}`);
        return hit.id;
    }
    private async reload(): Promise<void> {
        const seq = ++this.loadSeq;
        this.loading.set(true);
        try {
            const size = this.pageSize();
            const key = this.sortKey();
            const page = await this.api.listRows(this.tableId, {
                limit: size,
                offset: (this.page() - 1) * size,
                preds: this.predicates(),
                ...(key !== null && { orderBy: key, order: this.sortDir() }),
            });
            if (seq !== this.loadSeq)
                return;
            this.rows.set(page.rows);
            this.total.set(page.total);
        }
        finally {
            if (seq === this.loadSeq)
                this.loading.set(false);
        }
    }
    protected onPredicatesChanged(preds: FilterPredicate[]): void {
        this.predicates.set(preds);
        this.page.set(1);
        this.errorMessage.set(null);
        void this.reload().catch((err) => {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
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
        if (!this.writable())
            return;
        this.openRowEditDialog('create', blankRow(this.meta()), null);
    }
    protected onRowSelected(display: TableRow): void {
        const i = display[ROW_INDEX_KEY];
        const original = typeof i === 'number' ? this.rows()[i] : undefined;
        if (!original)
            return;
        this.openRowEditDialog('edit', { ...original }, original);
    }
    private openRowEditDialog(mode: 'create' | 'edit', value: Row, original: Row | null): void {
        this.editingOriginal = original;
        const ref = openModal(this.dialogSvc, RowEditDialog, {
            mode,
            columns: this.editColumns(),
            value,
            canDelete: this.writable(),
        } satisfies RowEditDialogData, { width: '32rem', maxWidth: '95vw' });
        ref.componentInstance.saved.subscribe((r) => {
            void this.onSave(ref, r.mode, r.value);
        });
        ref.componentInstance.deleteClicked.subscribe(() => {
            this.askDelete(ref);
        });
    }
    protected async onSave(ref: MatDialogRef<RowEditDialog>, mode: 'create' | 'edit', draft: Row): Promise<void> {
        const m = this.meta();
        if (!m)
            return;
        await runDialogAction(this.transloco, ref, 'errors.saveFailed', async () => {
            let mutated = true;
            if (mode === 'create') {
                await this.api.applyBatch(this.tableId, {
                    inserts: [editableOnly(draft, m)],
                });
            }
            else {
                const original = this.editingOriginal;
                if (!original)
                    return;
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
                else {
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
        confirmThen(this.dialogSvc, {
            title: this.transloco.translate('confirms.deleteRowTitle'),
            message: this.transloco.translate('confirms.deleteRowMessage'),
            confirmLabel: this.transloco.translate('common.delete'),
            danger: true,
        }, () => this.onDelete(ref));
    }
    protected openCsvExport(selectedDisplayRows: TableRow[]): void {
        this.csvSelection.set(this.toOriginals(selectedDisplayRows));
        this.errorMessage.set(null);
        const ref = openModal(this.dialogSvc, CsvExportDialog, {
            selectionCount: this.csvSelection().length,
            pageCount: this.rows().length,
        } satisfies CsvExportDialogData, { width: '27.5rem', maxWidth: '95vw' });
        ref.componentInstance.exported.subscribe((choice) => {
            void this.onCsvExport(ref, choice);
        });
    }
    protected async onCsvExport(ref: MatDialogRef<CsvExportDialog>, choice: CsvExportChoice): Promise<void> {
        const m = this.meta();
        if (!m)
            return;
        const filename = `${m.schemaName}.${m.tableName}.csv`;
        ref.componentRef?.setInput('busy', true);
        try {
            let text: string;
            if (choice.scope === 'all') {
                text = await this.api.exportCsvText(this.tableId, this.predicates());
            }
            else {
                const source = choice.scope === 'selection' ? this.csvSelection() : this.rows();
                text = this.rowsToCsv(source, m);
            }
            downloadCsv(filename, text, choice.excelCompat);
            ref.close();
        }
        catch (err) {
            ref.close();
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            ref.componentRef?.setInput('busy', false);
        }
    }
    private rowsToCsv(rows: Row[], m: TableMeta): string {
        const header = m.columns.map((c) => c.name);
        const body = rows.map((r) => m.columns.map((c) => {
            const v = r[c.name];
            if (v === null || v === undefined)
                return '';
            if (c.type === 'date' && typeof v === 'string')
                return v.slice(0, 10);
            return v as string | number | boolean;
        }));
        return buildCsv(header, body);
    }
    private toOriginals(displayRows: TableRow[]): Row[] {
        const out: Row[] = [];
        for (const d of displayRows) {
            const i = d[ROW_INDEX_KEY];
            const original = typeof i === 'number' ? this.rows()[i] : undefined;
            if (original)
                out.push(original);
        }
        return out;
    }
    protected async onCsvFile(file: File): Promise<void> {
        const m = this.meta();
        if (!m)
            return;
        this.errorMessage.set(null);
        let text: string;
        try {
            text = await file.text();
        }
        catch {
            this.errorMessage.set(this.transloco.translate('csvImport.errRead'));
            return;
        }
        const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`csvImport.${key}`, params);
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
        markConflicts(result.rows, m, this.rows());
        this.mergeRows.set(result.rows);
        this.openMergeDialog(result.rows);
    }
    private openMergeDialog(rows: CsvImportRow[]): void {
        const ref = openModal(this.dialogSvc, CsvMergeDialog, {
            columns: this.mergeColumns(),
            rows,
            identityNote: this.identityNote(),
        } satisfies CsvMergeDialogData, { width: '56.25rem', maxWidth: '95vw' });
        ref.componentInstance.applied.subscribe((appliedRows) => {
            this.onMergeApplied(ref, appliedRows);
        });
    }
    protected onMergeApplied(ref: MatDialogRef<CsvMergeDialog>, rows: CsvMergeRow[]): void {
        const applied = this.mergeRows().filter((r) => (rows as CsvImportRow[]).includes(r));
        this.pendingRows.update((cur) => [...applied, ...cur]);
        ref.close();
    }
    protected askBulkDelete(displayRows: TableRow[]): void {
        const originals = this.toOriginals(displayRows);
        const pending = this.toPending(displayRows);
        if (originals.length + pending.length === 0)
            return;
        this.pendingBulkRows = originals;
        this.pendingBulkPending = pending;
        this.errorMessage.set(null);
        confirmThen(this.dialogSvc, {
            title: this.transloco.translate('confirms.bulkDeleteTitle'),
            message: this.transloco.translate('confirms.bulkDeleteMessage', {
                count: originals.length + pending.length,
            }),
            confirmLabel: this.transloco.translate('common.ok'),
            danger: true,
        }, () => this.onBulkDelete());
    }
    protected async onBulkDelete(): Promise<void> {
        const m = this.meta();
        if (!m)
            return;
        this.saving.set(true);
        try {
            if (this.pendingBulkRows.length > 0) {
                await this.api.applyBatch(this.tableId, {
                    deletes: this.pendingBulkRows.map((r) => ({
                        key: pkOf(r, m),
                        rowVersion: rowVersionOf(r),
                    })),
                });
            }
            if (this.pendingBulkPending.length > 0) {
                const drop = new Set(this.pendingBulkPending);
                this.pendingRows.update((rows) => rows.filter((r) => !drop.has(r)));
            }
            const count = this.pendingBulkRows.length + this.pendingBulkPending.length;
            const reloadNeeded = this.pendingBulkRows.length > 0;
            this.pendingBulkRows = [];
            this.pendingBulkPending = [];
            if (reloadNeeded)
                await this.reload();
            this.toast('toasts.rowsDeleted', { count });
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.deleteFailed'));
        }
        finally {
            this.saving.set(false);
        }
    }
    protected async onDelete(ref: MatDialogRef<RowEditDialog>): Promise<void> {
        const m = this.meta();
        const original = this.editingOriginal;
        if (!m || !original)
            return;
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
