import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
export type LookupOption = Record<string, unknown>;
export interface LookupPickerDialogData {
    label: string;
    columns: string[];
}
const SEARCH_DEBOUNCE_MS = 300;
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-lookup-picker-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './lookup-picker-dialog.html',
    styleUrl: './lookup-picker-dialog.css',
})
export class LookupPickerDialog implements OnDestroy {
    private readonly data = inject<LookupPickerDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<LookupPickerDialog>>(MatDialogRef);
    protected readonly label = this.data.label;
    protected readonly columns = this.data.columns;
    readonly options = input<LookupOption[]>([]);
    readonly loading = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly searchChanged = output<string>();
    readonly picked = output<LookupOption>();
    protected readonly query = signal('');
    private timer: ReturnType<typeof setTimeout> | null = null;
    protected onQuery(v: string): void {
        this.query.set(v);
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.searchChanged.emit(this.query().trim());
        }, SEARCH_DEBOUNCE_MS);
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
        this.cancel();
    }
    ngOnDestroy(): void {
        if (this.timer)
            clearTimeout(this.timer);
    }
}
