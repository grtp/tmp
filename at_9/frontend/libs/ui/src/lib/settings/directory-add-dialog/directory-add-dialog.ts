import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export interface DirectoryCandidate {
    objectGuid: string;
    username: string;
    displayName: string;
    department?: string;
    employeeNo?: string;
    registered: boolean;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-directory-add-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './directory-add-dialog.html',
    styleUrl: './directory-add-dialog.css',
})
export class DirectoryAddDialog {
    private readonly dialogRef = inject<MatDialogRef<DirectoryAddDialog>>(MatDialogRef);
    readonly results = input<DirectoryCandidate[] | null>(null);
    readonly searching = input(false);
    readonly limit = input(150);
    readonly truncated = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly searchRequested = output<string>();
    readonly addRequested = output<DirectoryCandidate[]>();
    protected readonly query = signal('');
    protected readonly selectedGuids = signal<ReadonlySet<string>>(new Set());
    protected readonly canSearch = computed(() => this.query().trim().length >= 2 && !this.searching() && !this.saving());
    protected readonly selected = computed<DirectoryCandidate[]>(() => {
        const set = this.selectedGuids();
        return (this.results() ?? []).filter((r) => set.has(r.objectGuid) && !r.registered);
    });
    protected readonly canAdd = computed(() => this.selected().length > 0 && !this.saving());
    protected isSelected(r: DirectoryCandidate): boolean {
        return this.selectedGuids().has(r.objectGuid);
    }
    protected search(): void {
        if (!this.canSearch())
            return;
        this.selectedGuids.set(new Set());
        this.searchRequested.emit(this.query().trim());
    }
    protected select(r: DirectoryCandidate): void {
        if (r.registered || this.saving())
            return;
        const next = new Set(this.selectedGuids());
        if (next.has(r.objectGuid))
            next.delete(r.objectGuid);
        else
            next.add(r.objectGuid);
        this.selectedGuids.set(next);
    }
    protected add(): void {
        if (this.canAdd())
            this.addRequested.emit(this.selected());
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
