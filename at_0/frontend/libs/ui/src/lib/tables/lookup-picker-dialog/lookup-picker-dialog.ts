import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';
export type LookupOption = Record<string, unknown>;
export interface LookupPickerDialogData {
    label: string;
    columns: string[];
    storageKey?: string;
    keyTargets?: Record<string, string>;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-lookup-picker-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe, TmResizeColumnsDirective],
    templateUrl: './lookup-picker-dialog.html',
    styleUrl: './lookup-picker-dialog.css',
})
export class LookupPickerDialog {
    private readonly data = inject<LookupPickerDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<LookupPickerDialog>>(MatDialogRef);
    private readonly dialogs = inject(MatDialog);
    protected readonly label = this.data.label;
    protected readonly columns = this.data.columns;
    protected readonly storageKey = this.data.storageKey ?? '';
    protected readonly keyTargets = this.data.keyTargets ?? {};
    readonly options = input<LookupOption[]>([]);
    readonly loading = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly limit = input(150);
    readonly searchChanged = output<string>();
    readonly picked = output<LookupOption>();
    protected readonly query = signal('');
    protected readonly truncated = computed(() => this.options().length >= this.limit());
    protected readonly canSearch = computed(() => !this.loading());
    protected onQuery(v: string): void {
        this.query.set(v);
        if (v.trim() === '')
            this.search();
    }
    protected search(): void {
        if (!this.canSearch())
            return;
        this.searchChanged.emit(this.query().trim());
    }
    protected pick(o: LookupOption): void {
        this.picked.emit(o);
    }
    protected cell(o: LookupOption, col: string): string {
        const v = o[col];
        if (v === null || v === undefined)
            return '';
        if (typeof v === 'boolean')
            return v ? '○' : '-';
        return String(v);
    }
    protected cancel(): void {
        this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        if (this.dialogs.openDialogs[this.dialogs.openDialogs.length - 1] === this.dialogRef)
            this.cancel();
    }
}
