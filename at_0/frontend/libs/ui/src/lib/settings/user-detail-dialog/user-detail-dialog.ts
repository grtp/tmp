import { ChangeDetectionStrategy, Component, HostListener, inject, input, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export interface UserDetail {
    objectGuid: string;
    username: string;
    displayName: string;
    employeeNo?: string;
    department?: string;
    title?: string;
    email?: string;
    lastLoginAt?: string;
}
export interface UserDetailGroup {
    id: number;
    name: string;
    groupName: string;
}
export interface UserDetailDialogData {
    user: UserDetail;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-user-detail-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './user-detail-dialog.html',
    styleUrl: './user-detail-dialog.css',
})
export class UserDetailDialog {
    private readonly data = inject<UserDetailDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<UserDetailDialog>>(MatDialogRef);
    protected readonly user = this.data.user;
    readonly groups = input<UserDetailGroup[] | null>(null);
    protected close(): void {
        this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.close();
    }
}
