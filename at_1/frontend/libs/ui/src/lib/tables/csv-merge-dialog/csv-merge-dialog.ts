import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
export interface CsvMergeColumn {
    key: string;
    label: string;
}
export interface CsvMergeRow {
    display: Record<string, string>;
    conflict: boolean;
    typeError?: string;
}
export interface CsvMergeDialogData {
    columns: CsvMergeColumn[];
    rows: CsvMergeRow[];
    identityNote: boolean;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-csv-merge-dialog',
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './csv-merge-dialog.html',
    styleUrl: './csv-merge-dialog.css',
})
export class CsvMergeDialog {
    private readonly data = inject<CsvMergeDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<CsvMergeDialog>>(MatDialogRef);
    protected readonly columns = this.data.columns;
    protected readonly identityNote = this.data.identityNote;
    readonly busy = input(false);
    readonly applied = output<CsvMergeRow[]>();
    protected readonly workRows = signal<CsvMergeRow[]>([...this.data.rows]);
    protected readonly selected = signal<ReadonlySet<number>>(new Set());
    private dragging = false;
    private dragAnchor = 0;
    protected readonly conflictCount = computed(() => this.workRows().filter((r) => r.conflict).length);
    protected readonly typeErrorCount = computed(() => this.workRows().filter((r) => r.typeError).length);
    protected readonly effectiveCount = computed(() => this.workRows().length - this.typeErrorCount());
    protected readonly colsStyle = computed(() => `repeat(${this.columns.length}, minmax(110px, 1fr))`);
    protected onRowDown(index: number, e: PointerEvent): void {
        if (e.button !== 0)
            return;
        e.preventDefault();
        this.dragging = true;
        this.dragAnchor = index;
        const cur = this.selected();
        if (cur.size === 1 && cur.has(index)) {
            this.selected.set(new Set());
            this.dragging = false;
            return;
        }
        this.selected.set(new Set([index]));
    }
    protected onRowEnter(index: number): void {
        if (!this.dragging)
            return;
        const [from, to] = this.dragAnchor <= index
            ? [this.dragAnchor, index]
            : [index, this.dragAnchor];
        const next = new Set<number>();
        for (let i = from; i <= to; i++)
            next.add(i);
        this.selected.set(next);
    }
    @HostListener('document:pointerup')
    protected onPointerUp(): void {
        this.dragging = false;
    }
    protected removeConflicts(): void {
        this.workRows.update((rows) => rows.filter((r) => !r.conflict));
        this.selected.set(new Set());
    }
    protected removeSelected(): void {
        const sel = this.selected();
        this.workRows.update((rows) => rows.filter((_, i) => !sel.has(i)));
        this.selected.set(new Set());
    }
    protected apply(): void {
        if (this.busy())
            return;
        this.applied.emit(this.workRows().filter((r) => !r.typeError));
    }
    protected cancel(): void {
        if (!this.busy()) {
            this.dialogRef.close();
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
