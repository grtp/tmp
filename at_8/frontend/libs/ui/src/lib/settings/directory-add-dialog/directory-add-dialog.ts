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
    readonly addRequested = output<DirectoryCandidate>();
    protected readonly query = signal('');
    protected readonly selectedGuid = signal<string | null>(null);
    protected readonly canSearch = computed(() => this.query().trim().length >= 2 && !this.searching() && !this.saving());
    protected readonly selected = computed(() => this.results()?.find((r) => r.objectGuid === this.selectedGuid() && !r.registered) ?? null);
    protected readonly canAdd = computed(() => this.selected() !== null && !this.saving());
    protected search(): void {
        if (!this.canSearch())
            return;
        this.selectedGuid.set(null);
        this.searchRequested.emit(this.query().trim());
    }
    protected select(r: DirectoryCandidate): void {
        if (r.registered)
            return;
        this.selectedGuid.set(this.selectedGuid() === r.objectGuid ? null : r.objectGuid);
    }
    protected add(): void {
        const s = this.selected();
        if (s && !this.saving())
            this.addRequested.emit(s);
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
