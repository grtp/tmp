import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
export type GroupExportKind = 'json' | 'csv' | 'csvRank';
export interface GroupExportChoice {
    kind: GroupExportKind;
    excelCompat: boolean;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-group-export-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './group-export-dialog.html',
    styleUrl: './group-export-dialog.css',
})
export class GroupExportDialog {
    private readonly dialogRef = inject<MatDialogRef<GroupExportDialog>>(MatDialogRef);
    readonly busy = input(false);
    readonly rankAvailable = input(false);
    readonly exported = output<GroupExportChoice>();
    protected readonly excelCompat = signal(true);
    protected choose(kind: GroupExportKind): void {
        if (this.busy())
            return;
        this.exported.emit({ kind, excelCompat: this.excelCompat() });
    }
    protected cancel(): void {
        if (!this.busy())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
