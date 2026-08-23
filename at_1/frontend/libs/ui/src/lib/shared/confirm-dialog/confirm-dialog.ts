import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export interface ConfirmData {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-confirm-dialog',
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './confirm-dialog.html',
    styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
    protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<ConfirmDialog>>(MatDialogRef);
    readonly busy = input(false);
    readonly confirmed = output<void>();
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
    protected cancel(): void {
        if (!this.busy()) {
            this.dialogRef.close();
        }
    }
}
