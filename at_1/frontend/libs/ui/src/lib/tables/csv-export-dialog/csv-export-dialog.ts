import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
export interface CsvExportChoice {
    scope: 'selection' | 'page' | 'all';
    excelCompat: boolean;
}
export interface CsvExportDialogData {
    selectionCount: number;
    pageCount: number;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-csv-export-dialog',
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './csv-export-dialog.html',
    styleUrl: './csv-export-dialog.css',
})
export class CsvExportDialog {
    private readonly data = inject<CsvExportDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<CsvExportDialog>>(MatDialogRef);
    protected readonly selectionCount = this.data.selectionCount;
    protected readonly pageCount = this.data.pageCount;
    readonly busy = input(false);
    readonly exported = output<CsvExportChoice>();
    protected readonly excelCompat = signal(false);
    protected choose(scope: CsvExportChoice['scope']): void {
        if (this.busy())
            return;
        this.exported.emit({ scope, excelCompat: this.excelCompat() });
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
