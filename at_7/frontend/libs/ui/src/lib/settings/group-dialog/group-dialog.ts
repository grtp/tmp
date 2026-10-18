import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { SubjectKind, SubjectOption, SubjectRef, subjectKey, } from '../resource-auth-dialog/resource-auth-dialog';
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
    protected readonly mode = this.data.mode;
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly members = input<SubjectOption[]>([]);
    readonly subjectOptions = input<SubjectOption[]>([]);
    readonly loadingMembers = input(false);
    readonly parents = input<{
        id: number;
        name: string;
    }[]>([]);
    readonly effectiveUsers = input<number | null>(null);
    readonly saved = output<GroupDraft>();
    readonly memberAdded = output<SubjectRef>();
    readonly memberRemoved = output<SubjectRef>();
    protected readonly name = signal(this.data.value?.name ?? '');
    protected readonly displayName = signal(this.data.value?.displayName ?? '');
    protected readonly description = signal(this.data.value?.description ?? '');
    protected readonly rank = signal(this.data.value?.rank == null ? '' : String(this.data.value.rank));
    protected readonly search = signal('');
    protected readonly kindFilter = signal<SubjectKind>('user');
    protected readonly subjectKey = subjectKey;
    protected readonly rankInvalid = computed(() => {
        const v = this.rank().trim();
        if (v === '')
            return false;
        const n = Number(v);
        return !Number.isInteger(n) || n < 0 || n > 99;
    });
    protected readonly canSave = computed(() => this.name().trim() !== '' && !this.rankInvalid());
    protected readonly filteredCandidates = computed<SubjectOption[]>(() => {
        const q = this.search().trim().toLowerCase();
        const kind = this.kindFilter();
        const present = new Set(this.members().map(subjectKey));
        return this.subjectOptions()
            .filter((s) => s.subjectKind === kind && !present.has(subjectKey(s)))
            .filter((s) => !q ||
            s.name.toLowerCase().includes(q) ||
            (s.username ?? '').toLowerCase().includes(q))
            .slice(0, 30);
    });
    protected save(): void {
        this.saved.emit({
            name: this.name().trim(),
            displayName: this.displayName().trim() || this.name().trim(),
            description: this.description().trim(),
            rank: this.rank().trim() === '' ? null : Number(this.rank().trim()),
        });
    }
    protected add(s: SubjectRef): void {
        this.memberAdded.emit({ subjectKind: s.subjectKind, subjectId: s.subjectId });
    }
    protected remove(s: SubjectRef): void {
        this.memberRemoved.emit({ subjectKind: s.subjectKind, subjectId: s.subjectId });
    }
    protected cancel(): void {
        if (!this.saving())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
