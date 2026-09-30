import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
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
}
export interface ResourceAuthEntryView extends SubjectOption {
    authLevel: ResourceAuthLevel;
}
export interface ResourceAuthDialogData {
    title: string;
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
    protected readonly title = this.data.title;
    readonly entries = input<ResourceAuthEntryView[]>([]);
    readonly subjectOptions = input<SubjectOption[]>([]);
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly levelChanged = output<SubjectRef & {
        authLevel: ResourceAuthLevel;
    }>();
    readonly removeClicked = output<SubjectRef>();
    readonly addClicked = output<SubjectRef>();
    protected readonly search = signal('');
    protected readonly kindFilter = signal<SubjectKind>('user');
    protected readonly subjectKey = subjectKey;
    protected readonly filteredCandidates = computed<SubjectOption[]>(() => {
        const q = this.search().trim().toLowerCase();
        const kind = this.kindFilter();
        const granted = new Set(this.entries().map(subjectKey));
        return this.subjectOptions()
            .filter((s) => s.subjectKind === kind && !granted.has(subjectKey(s)))
            .filter((s) => !q ||
            s.name.toLowerCase().includes(q) ||
            (s.username ?? '').toLowerCase().includes(q))
            .slice(0, 30);
    });
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
    protected add(s: SubjectRef): void {
        this.addClicked.emit({ subjectKind: s.subjectKind, subjectId: s.subjectId });
    }
    protected close(): void {
        if (!this.saving())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.close();
    }
}
