import { MatButtonModule } from '@angular/material/button';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export interface ConnectionDraft {
    name: string;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    options?: string;
    schemaName?: string;
    enabled: boolean;
}
export interface ConnectionSubmit extends ConnectionDraft {
    password: string;
}
export interface ConnectionDialogData {
    mode: 'create' | 'edit';
    value: ConnectionDraft | null;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-connection-dialog',
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './connection-dialog.html',
    styleUrl: './connection-dialog.css',
})
export class ConnectionDialog {
    private readonly data = inject<ConnectionDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<ConnectionDialog>>(MatDialogRef);
    protected readonly mode = this.data.mode;
    readonly saving = input(false);
    readonly testing = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly testResult = input<string | null>(null);
    readonly saved = output<ConnectionSubmit>();
    readonly testClicked = output<ConnectionSubmit>();
    protected readonly name = signal(this.data.value?.name ?? '');
    protected readonly host = signal(this.data.value?.host ?? '');
    protected readonly port = signal(this.data.value?.port ?? 1433);
    protected readonly databaseName = signal(this.data.value?.databaseName ?? '');
    protected readonly username = signal(this.data.value?.username ?? '');
    protected readonly password = signal('');
    protected readonly options = signal(this.data.value?.options ?? '');
    protected readonly schemaName = signal(this.data.value?.schemaName ?? '');
    protected readonly canTest = computed(() => this.host().trim() !== '' &&
        this.databaseName().trim() !== '' &&
        this.username().trim() !== '' &&
        (this.mode === 'edit' || this.password() !== ''));
    protected readonly canSave = computed(() => this.name().trim() !== '' &&
        this.host().trim() !== '' &&
        this.databaseName().trim() !== '' &&
        this.username().trim() !== '' &&
        (this.mode === 'edit' || this.password() !== ''));
    private submit(): ConnectionSubmit {
        return {
            name: this.name().trim(),
            host: this.host().trim(),
            port: this.port() || 1433,
            databaseName: this.databaseName().trim(),
            username: this.username().trim(),
            password: this.password(),
            options: this.options().trim() || undefined,
            schemaName: this.schemaName().trim(),
            enabled: this.data.value?.enabled ?? true,
        };
    }
    protected test(): void {
        this.testClicked.emit(this.submit());
    }
    protected save(): void {
        this.saved.emit(this.submit());
    }
    protected cancel(): void {
        if (!this.saving() && !this.testing()) {
            this.dialogRef.close();
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
