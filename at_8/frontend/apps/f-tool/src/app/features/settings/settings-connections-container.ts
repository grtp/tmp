import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoService } from '@jsverse/transloco';
import { ConnectionDialog, ConnectionDraft, ConnectionSubmit, SettingsConnection, SettingsPage, SettingsTab, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { createReloadRunner } from '../../core/reload-action';
import { AdminApi } from '../../core/api/admin-api';
import { Connection } from '../../core/models';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-connections-container',
    imports: [SettingsPage],
    templateUrl: './settings-connections-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsConnectionsContainer {
    private admin = inject(AdminApi);
    private transloco = inject(TranslocoService);
    private readonly dialog = inject(MatDialog);
    private readonly snackBar = inject(MatSnackBar);
    protected readonly visibleTabs = signal<SettingsTab[]>(['connections']);
    protected readonly loading = signal(false);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    private readonly connections = signal<Connection[]>([]);
    protected readonly settingsConnections = computed<SettingsConnection[]>(() => this.connections().map((c) => ({
        id: c.id,
        name: c.name,
        host: c.host,
        port: c.port,
        databaseName: c.databaseName,
        username: c.username,
        schemaName: c.schemaName,
        color: c.color,
        enabled: c.enabled,
    })));
    private editingConnId: number | null = null;
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            this.connections.set(await this.admin.listConnections());
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            if (!silent)
                this.loading.set(false);
        }
    }
    private readonly run = createReloadRunner(this.transloco, this.saving, this.errorMessage, (silent) => this.reload(silent));
    protected openConnectionCreate(): void {
        this.editingConnId = null;
        this.openConnectionDialog({ mode: 'create', value: null });
    }
    protected openConnectionEdit(id: number): void {
        const c = this.connections().find((x) => x.id === id);
        if (!c)
            return;
        this.editingConnId = id;
        this.openConnectionDialog({
            mode: 'edit',
            value: {
                name: c.name,
                host: c.host,
                port: c.port,
                databaseName: c.databaseName,
                username: c.username,
                options: c.options,
                schemaName: c.schemaName,
                color: c.color,
                enabled: c.enabled,
            },
        });
    }
    private openConnectionDialog(data: {
        mode: 'create' | 'edit';
        value: ConnectionDraft | null;
    }): void {
        const ref = openModal(this.dialog, ConnectionDialog, data, {
            width: '30rem',
            maxWidth: '95vw',
        });
        const editingId = this.editingConnId;
        ref.componentInstance.saved.subscribe((e: ConnectionSubmit) => {
            void runDialogAction(this.transloco, ref, 'errors.saveFailed', async () => {
                if (data.mode === 'create') {
                    await this.admin.createConnection({
                        name: e.name,
                        host: e.host,
                        port: e.port,
                        databaseName: e.databaseName,
                        username: e.username,
                        password: e.password,
                        options: e.options,
                        schemaName: e.schemaName,
                        color: e.color,
                    });
                }
                else {
                    if (editingId === null)
                        return;
                    await this.admin.updateConnection(editingId, {
                        name: e.name,
                        host: e.host,
                        port: e.port,
                        databaseName: e.databaseName,
                        username: e.username,
                        ...(e.password !== '' ? { password: e.password } : {}),
                        options: e.options,
                        schemaName: e.schemaName,
                        color: e.color,
                    });
                }
                ref.close();
                await this.reload(true);
            });
        });
        ref.componentInstance.testClicked.subscribe((e: ConnectionSubmit) => {
            void (async () => {
                ref.componentRef?.setInput('testing', true);
                ref.componentRef?.setInput('testResult', null);
                try {
                    const result = e.password === '' && editingId !== null
                        ? await this.admin.testConnection(editingId)
                        : await this.admin.testConnectionParams({
                            name: e.name || 'test',
                            host: e.host,
                            port: e.port,
                            databaseName: e.databaseName,
                            username: e.username,
                            password: e.password,
                            options: e.options,
                        });
                    ref.componentRef?.setInput('testResult', formatTestResult(this.transloco, result));
                }
                catch (err) {
                    ref.componentRef?.setInput('testResult', apiErrorText(this.transloco, err, 'errors.testFailed'));
                }
                finally {
                    ref.componentRef?.setInput('testing', false);
                }
            })();
        });
    }
    protected async onConnectionTest(id: number): Promise<void> {
        const name = this.connections().find((c) => c.id === id)?.name ?? id;
        try {
            const result = await this.admin.testConnection(id);
            this.snackBar.open(`${name}: ${formatTestResult(this.transloco, result)}`, undefined, {
                duration: result.ok ? 4000 : 6000,
                panelClass: result.ok ? 'toast-ok' : 'toast-ng',
            });
        }
        catch (err) {
            this.snackBar.open(`${name}: ${apiErrorText(this.transloco, err, 'errors.testFailed')}`, undefined, { duration: 6000, panelClass: 'toast-ng' });
        }
    }
    protected onConnectionToggled(e: {
        id: number;
        enabled: boolean;
    }): void {
        void this.run(async () => {
            await this.admin.updateConnection(e.id, { enabled: e.enabled });
        }, 'errors.updateFailed');
    }
    protected askConnectionDelete(id: number): void {
        const c = this.connections().find((x) => x.id === id);
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.deleteConnectionTitle'),
            message: this.transloco.translate('confirms.deleteConnectionMessage', {
                name: c?.name ?? id,
            }),
            danger: true,
        }, () => this.run(async () => {
            await this.admin.deleteConnection(id);
        }, 'errors.deleteFailed'));
    }
}
function formatTestResult(transloco: TranslocoService, r: {
    ok: boolean;
    message?: string;
    latencyMs?: number;
}): string {
    if (r.ok) {
        return transloco.translate('settings.testOk', { ms: r.latencyMs ?? 0 });
    }
    return r.message || transloco.translate('errors.testFailed');
}
