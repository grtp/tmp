import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { SubjectOption, SubjectRef, subjectKey } from '../resource-auth-dialog/resource-auth-dialog';
export interface GroupDraft {
    name: string;
    displayName: string;
    description: string;
    rank: number | null;
}
export interface GroupDialogData {
    mode: 'create' | 'edit';
    value: GroupDraft | null;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-group-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './group-dialog.html',
    styleUrl: './group-dialog.css',
})
export class GroupDialog {
    private readonly data = inject<GroupDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<GroupDialog>>(MatDialogRef);
    private readonly dialogs = inject(MatDialog);
    protected readonly mode = this.data.mode;
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly members = input<SubjectOption[]>([]);
    readonly loadingMembers = input(false);
    readonly parents = input<{
        id: number;
        name: string;
    }[]>([]);
    readonly effectiveUsers = input<number | null>(null);
    readonly saved = output<GroupDraft>();
    readonly memberRemoved = output<SubjectRef>();
    readonly addClicked = output<void>();
    protected readonly name = signal(this.data.value?.name ?? '');
    protected readonly displayName = signal(this.data.value?.displayName ?? '');
    protected readonly description = signal(this.data.value?.description ?? '');
    protected readonly rank = signal(this.data.value?.rank == null ? '' : String(this.data.value.rank));
    protected readonly rankInvalid = computed(() => {
        const v = this.rank().trim();
        if (v === '')
            return false;
        const n = Number(v);
        return !Number.isInteger(n) || n < 0 || n > 99;
    });
    protected readonly canSave = computed(() => this.name().trim() !== '' && !this.rankInvalid());
    protected readonly subjectKey = subjectKey;
    protected readonly memberCounts = computed(() => ({
        users: this.members().filter((m) => m.subjectKind === 'user').length,
        groups: this.members().filter((m) => m.subjectKind === 'group').length,
    }));
    protected save(): void {
        this.saved.emit({
            name: this.name().trim(),
            displayName: this.displayName().trim() || this.name().trim(),
            description: this.description().trim(),
            rank: this.rank().trim() === '' ? null : Number(this.rank().trim()),
        });
    }
    protected remove(s: SubjectRef): void {
        if (this.saving())
            return;
        this.memberRemoved.emit({ subjectKind: s.subjectKind, subjectId: s.subjectId });
    }
    protected cancel(): void {
        if (!this.saving())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        if (this.dialogs.openDialogs[this.dialogs.openDialogs.length - 1] === this.dialogRef)
            this.cancel();
    }
}
