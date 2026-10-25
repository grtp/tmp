import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { SubjectKind, SubjectOption, SubjectRef, subjectKey, } from '../resource-auth-dialog/resource-auth-dialog';
export interface SubjectPickDialogData {
    titleKey: string;
    name: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-subject-pick-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './subject-pick-dialog.html',
    styleUrl: './subject-pick-dialog.css',
})
export class SubjectPickDialog {
    private readonly data = inject<SubjectPickDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<SubjectPickDialog>>(MatDialogRef);
    private readonly dialogs = inject(MatDialog);
    protected readonly titleKey = this.data.titleKey;
    protected readonly name = this.data.name;
    readonly userResults = input<SubjectOption[] | null>(null);
    readonly limit = input(200);
    readonly truncated = input(false);
    readonly groupOptions = input<SubjectOption[]>([]);
    readonly excluded = input<SubjectOption[]>([]);
    readonly searching = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly searchRequested = output<string>();
    readonly picked = output<SubjectOption[]>();
    protected readonly query = signal('');
    protected readonly applied = signal('');
    protected readonly kindFilter = signal<SubjectKind>('user');
    protected readonly selectedMap = signal<ReadonlyMap<string, SubjectOption>>(new Map());
    protected readonly subjectKey = subjectKey;
    private readonly excludedKeys = computed(() => new Set(this.excluded().map(subjectKey)));
    protected readonly filteredCandidates = computed<SubjectOption[]>(() => {
        const excluded = this.excludedKeys();
        if (this.kindFilter() === 'user') {
            return (this.userResults() ?? []).filter((s) => !excluded.has(subjectKey(s)));
        }
        const q = this.applied().toLowerCase();
        return this.groupOptions()
            .filter((s) => !excluded.has(subjectKey(s)))
            .filter((s) => !q ||
            s.name.toLowerCase().includes(q) ||
            (s.username ?? '').toLowerCase().includes(q))
            .slice(0, 200);
    });
    protected readonly selected = computed<SubjectOption[]>(() => {
        const excluded = this.excludedKeys();
        return [...this.selectedMap().values()].filter((s) => !excluded.has(subjectKey(s)));
    });
    protected readonly canAdd = computed(() => this.selected().length > 0 && !this.saving());
    protected readonly canSearch = computed(() => !this.searching() && !this.saving());
    protected onQueryInput(value: string): void {
        this.query.set(value);
        if (value.trim() === '')
            this.search();
    }
    protected search(): void {
        if (!this.canSearch())
            return;
        const q = this.query().trim();
        this.applied.set(q);
        if (this.kindFilter() === 'user')
            this.searchRequested.emit(q);
    }
    protected setKind(kind: SubjectKind): void {
        if (this.kindFilter() === kind)
            return;
        this.kindFilter.set(kind);
        if (kind === 'user' && this.userResults() === null)
            this.searchRequested.emit(this.applied());
    }
    protected isSelected(s: SubjectRef): boolean {
        return this.selectedMap().has(subjectKey(s));
    }
    protected toggle(s: SubjectOption): void {
        if (this.saving())
            return;
        const next = new Map(this.selectedMap());
        const k = subjectKey(s);
        if (next.has(k))
            next.delete(k);
        else
            next.set(k, s);
        this.selectedMap.set(next);
    }
    protected add(): void {
        if (this.canAdd())
            this.picked.emit(this.selected());
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
