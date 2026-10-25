import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export type ResourceAuthLevel = 'r' | 'rw';
export type SubjectKind = 'user' | 'group';
export interface SubjectRef {
    subjectKind: SubjectKind;
    subjectId: string;
}
export interface SubjectOption extends SubjectRef {
    name: string;
    username?: string;
    department?: string;
}
export interface ResourceAuthEntryView extends SubjectOption {
    authLevel: ResourceAuthLevel;
}
export interface ResourceAuthDialogData {
    title: string;
    singleLevel?: boolean;
}
export function subjectKey(s: SubjectRef): string {
    return `${s.subjectKind}:${s.subjectId}`;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-resource-auth-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './resource-auth-dialog.html',
    styleUrl: './resource-auth-dialog.css',
})
export class ResourceAuthDialog {
    private readonly data = inject<ResourceAuthDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<ResourceAuthDialog>>(MatDialogRef);
    private readonly dialogs = inject(MatDialog);
    protected readonly title = this.data.title;
    protected readonly singleLevel = this.data.singleLevel ?? false;
    readonly entries = input<ResourceAuthEntryView[]>([]);
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly levelChanged = output<SubjectRef & {
        authLevel: ResourceAuthLevel;
    }>();
    readonly removeClicked = output<SubjectRef>();
    readonly addClicked = output<void>();
    protected readonly subjectKey = subjectKey;
    protected toggleLevel(e: ResourceAuthEntryView): void {
        this.levelChanged.emit({
            subjectKind: e.subjectKind,
            subjectId: e.subjectId,
            authLevel: e.authLevel === 'rw' ? 'r' : 'rw',
        });
    }
    protected remove(e: SubjectRef): void {
        this.removeClicked.emit({ subjectKind: e.subjectKind, subjectId: e.subjectId });
    }
    protected close(): void {
        if (!this.saving())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        if (this.dialogs.openDialogs[this.dialogs.openDialogs.length - 1] === this.dialogRef)
            this.close();
    }
}
