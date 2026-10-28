import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { UsersGridAction } from '../users-grid/users-grid';
export type SubjectAddKind = 'user' | 'group';
export type SubjectAddLevel = 'user' | 'maintainer' | 'admin';
export interface SubjectAddDialogData {
    kind: SubjectAddKind;
}
export interface SubjectAddCandidate {
    id: string;
    name: string;
    sub?: string;
}
export interface SubjectAddResult {
    id: string;
    actionId: number;
    level: SubjectAddLevel;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-subject-add-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './subject-add-dialog.html',
    styleUrl: './subject-add-dialog.css',
})
export class SubjectAddDialog {
    private readonly data = inject<SubjectAddDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<SubjectAddDialog>>(MatDialogRef);
    protected readonly kind = this.data.kind;
    readonly candidates = input<SubjectAddCandidate[]>([]);
    readonly actions = input<UsersGridAction[]>([]);
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly added = output<SubjectAddResult>();
    protected readonly search = signal('');
    protected readonly selectedId = signal<string | null>(null);
    private readonly actionIdState = signal<number | null>(null);
    protected readonly level = signal<SubjectAddLevel>('user');
    protected readonly LEVELS: SubjectAddLevel[] = ['user', 'maintainer', 'admin'];
    protected readonly filtered = computed<SubjectAddCandidate[]>(() => {
        const q = this.search().trim().toLowerCase();
        return this.candidates()
            .filter((c) => !q ||
            c.name.toLowerCase().includes(q) ||
            (c.sub ?? '').toLowerCase().includes(q))
            .slice(0, 30);
    });
    protected readonly selected = computed(() => this.candidates().find((c) => c.id === this.selectedId()) ?? null);
    protected readonly actionId = computed<number | null>(() => {
        const chosen = this.actionIdState();
        if (chosen !== null && this.actions().some((a) => a.id === chosen))
            return chosen;
        return this.actions()[0]?.id ?? null;
    });
    protected readonly canAdd = computed(() => this.selected() !== null && this.actionId() !== null && !this.saving());
    protected select(c: SubjectAddCandidate): void {
        this.selectedId.set(this.selectedId() === c.id ? null : c.id);
    }
    protected onActionChange(value: string): void {
        const id = Number(value);
        this.actionIdState.set(Number.isFinite(id) ? id : null);
    }
    protected onLevelChange(value: string): void {
        if (this.LEVELS.includes(value as SubjectAddLevel)) {
            this.level.set(value as SubjectAddLevel);
        }
    }
    protected add(): void {
        const s = this.selected();
        const actionId = this.actionId();
        if (!s || actionId === null || this.saving())
            return;
        this.added.emit({ id: s.id, actionId, level: this.level() });
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
