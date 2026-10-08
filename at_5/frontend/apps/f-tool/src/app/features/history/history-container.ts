import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, signal, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, CsvExportChoice, CsvExportDialog, CsvExportDialogData, DataTablePage, FilterColumn, FilterPredicate, TableRow, } from '@f-tool/ui';
import { AdminApi } from '../../core/api/admin-api';
import { buildCsv, downloadCsv } from '../../core/csv';
import { openModal } from '../../core/dialog';
import { HistoryEntry } from '../../core/models';
import { formatJst } from '../../core/time';
const PAGE_SIZE = 50;
const ROW_INDEX_KEY = '$i';
interface HistoryRow {
    id: number;
    occurredAt: string;
    username: string;
    actionCode: string;
    operation: string;
    target: string;
    detailText: string;
    hasOverflow: boolean;
    result: string;
    errorCode?: string;
    clientIp?: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-history-container',
    imports: [DataTablePage, MatButtonModule, MatIcon, TranslocoPipe],
    templateUrl: './history-container.html',
    styleUrl: './history-container.css',
})
export class HistoryContainer {
    private admin = inject(AdminApi);
    private dialogSvc = inject(MatDialog);
    private transloco = inject(TranslocoService);
    protected readonly pageSize = signal(PAGE_SIZE);
    protected readonly rows = signal<HistoryRow[]>([]);
    protected readonly total = signal(0);
    protected readonly page = signal(1);
    protected readonly loading = signal(false);
    protected readonly predicates = signal<FilterPredicate[]>([]);
    protected readonly expandedIndex = signal(-1);
    private readonly lang = toSignal(this.transloco.langChanges$, {
        initialValue: this.transloco.getActiveLang(),
    });
    private t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly resultTpl = viewChild<TemplateRef<CellContext>>('resultTpl');
    protected readonly columnDefs = computed<ColumnDef[]>(() => [
        { key: 'occurredAt', label: this.t('history.thAt'), mono: true },
        { key: 'username', label: this.t('history.thUser') },
        { key: 'actionCode', label: this.t('history.thAction'), mono: true },
        { key: 'operation', label: this.t('history.thOperation'), mono: true },
        { key: 'target', label: this.t('history.thTarget'), mono: true },
        { key: 'result', label: this.t('history.thResult'), template: this.resultTpl() },
        { key: 'clientIp', label: this.t('history.thIp'), mono: true },
    ]);
    protected readonly filterColumns = computed<FilterColumn[]>(() => [
        { key: 'occurredAt', label: this.t('history.thAt'), type: 'datetime' },
        { key: 'username', label: this.t('history.thUser'), type: 'string' },
        { key: 'actionCode', label: this.t('history.thAction'), type: 'string' },
        { key: 'operation', label: this.t('history.thOperation'), type: 'string' },
        { key: 'target', label: this.t('history.thTarget'), type: 'string' },
        {
            key: 'result',
            label: this.t('history.thResult'),
            type: 'enum',
            enumValues: [
                { value: 'success', label: this.t('history.resultOk') },
                { value: 'failure', label: this.t('history.resultNg') },
            ],
        },
        { key: 'clientIp', label: this.t('history.thIp'), type: 'string' },
    ]);
    protected readonly displayRows = computed<TableRow[]>(() => this.rows().map((r, i) => ({
        [ROW_INDEX_KEY]: i,
        occurredAt: r.occurredAt,
        username: r.username,
        actionCode: r.actionCode,
        operation: r.operation,
        target: r.target,
        result: r.result,
        clientIp: r.clientIp ?? '',
    })));
    constructor() {
        void this.reload();
    }
    protected rowOf(display: TableRow): HistoryRow | undefined {
        const i = display[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.rows()[i] : undefined;
    }
    private async reload(): Promise<void> {
        this.loading.set(true);
        this.expandedIndex.set(-1);
        try {
            const size = this.pageSize();
            const page = await this.admin.listHistory({
                limit: size,
                offset: (this.page() - 1) * size,
                preds: this.predicates(),
            });
            this.rows.set(page.entries.map(toRow));
            this.total.set(page.total);
        }
        finally {
            this.loading.set(false);
        }
    }
    protected onPredicatesChanged(preds: FilterPredicate[]): void {
        this.predicates.set(preds);
        this.page.set(1);
        void this.reload();
    }
    protected onRowSelected(display: TableRow): void {
        const row = this.rowOf(display);
        const i = display[ROW_INDEX_KEY];
        if (!row || typeof i !== 'number' || row.detailText === '')
            return;
        this.expandedIndex.set(this.expandedIndex() === i ? -1 : i);
    }
    protected async onDownloadRequested(display: TableRow): Promise<void> {
        const row = this.rowOf(display);
        if (!row)
            return;
        let detail: unknown;
        if (row.hasOverflow) {
            detail = await this.admin.getHistoryOverflow(row.id);
        }
        else {
            try {
                detail = JSON.parse(row.detailText);
            }
            catch {
                detail = row.detailText;
            }
        }
        const payload = {
            meta: {
                id: row.id,
                occurredAt: row.occurredAt,
                timezone: 'JST',
                username: row.username,
                actionCode: row.actionCode,
                operation: row.operation,
                target: row.target,
                result: row.result,
                errorCode: row.errorCode ?? null,
                clientIp: row.clientIp ?? null,
            },
            detail,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `history-${row.id}-detail.json`;
        a.click();
        URL.revokeObjectURL(url);
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
    protected openCsvExport(selectedDisplay: TableRow[]): void {
        const selected = selectedDisplay
            .map((d) => this.rowOf(d))
            .filter((r): r is HistoryRow => !!r);
        const ref = openModal(this.dialogSvc, CsvExportDialog, {
            selectionCount: selected.length,
            pageCount: this.rows().length,
        } satisfies CsvExportDialogData, { width: '27.5rem', maxWidth: '95vw' });
        ref.componentInstance.exported.subscribe((choice) => {
            void this.onCsvExport(ref, choice, selected);
        });
    }
    protected async onCsvExport(ref: MatDialogRef<CsvExportDialog>, choice: CsvExportChoice, selected: HistoryRow[]): Promise<void> {
        ref.componentRef?.setInput('busy', true);
        try {
            let text: string;
            if (choice.scope === 'all') {
                text = await this.admin.exportHistoryCsv(this.predicates());
            }
            else {
                const source = choice.scope === 'selection' ? selected : this.rows();
                text = historyRowsToCsv(source);
            }
            downloadCsv('operation_history.csv', text, choice.excelCompat);
            ref.close();
        }
        finally {
            ref.componentRef?.setInput('busy', false);
        }
    }
}
function historyRowsToCsv(rows: HistoryRow[]): string {
    return buildCsv([
        'occurred_at_jst', 'username', 'action_code', 'operation',
        'target', 'result', 'error_code', 'client_ip', 'detail',
    ], rows.map((r) => [
        r.occurredAt, r.username, r.actionCode, r.operation,
        r.target ?? '', r.result, r.errorCode ?? '', r.clientIp ?? '',
        compactDetail(r.detailText),
    ]));
}
function compactDetail(detailText: string): string {
    if (!detailText)
        return '';
    try {
        return JSON.stringify(JSON.parse(detailText));
    }
    catch {
        return detailText;
    }
}
function toRow(e: HistoryEntry): HistoryRow {
    const detail = e.detail as {
        truncated?: boolean;
        overflowKey?: string;
    } | undefined;
    return {
        id: e.id,
        occurredAt: formatJst(e.occurredAt),
        username: e.username,
        actionCode: e.actionCode,
        operation: e.operation,
        target: e.target ?? '',
        detailText: e.detail ? JSON.stringify(e.detail, null, 2) : '',
        hasOverflow: !!detail?.truncated && !!detail?.overflowKey,
        result: e.result,
        errorCode: e.errorCode,
        clientIp: e.clientIp,
    };
}
