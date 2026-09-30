import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoService } from '@jsverse/transloco';
import { ConnectionDialog, ConnectionDraft, ConnectionSubmit, DialogConnection, ManagedTableEditValue, ManagedTableDialog, ManagedTableRegistration, ResourceAuthDialog, ResourceAuthEntryView, ResourceAuthLevel as DialogResourceAuthLevel, SettingsConnection, SettingsManagedTable, SettingsPage, SettingsTab, SubjectOption, SubjectRef, TableAuthCount, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { createReloadRunner } from '../../core/reload-action';
import { AdminApi } from '../../core/api/admin-api';
import { TablesApi } from '../../core/api/tables-api';
import { Connection, ManagedTable, ResourceType } from '../../core/models';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-tables-container',
    imports: [SettingsPage],
    templateUrl: './settings-tables-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsTablesContainer {
    private admin = inject(AdminApi);
    private tablesApi = inject(TablesApi);
    private transloco = inject(TranslocoService);
    protected readonly visibleTabs = signal<SettingsTab[]>([
        'tables',
        'tablePermissions',
        'connections',
    ]);
    protected readonly tab = signal<SettingsTab>('tables');
    protected readonly loading = signal(false);
    protected readonly tableAuthCounts = signal<Record<number, TableAuthCount>>({});
    protected readonly allTablesAuthCount = signal<TableAuthCount>({ users: 0, groups: 0 });
    private readonly tablesActionId = signal<number | null>(null);
    private readonly dialog = inject(MatDialog);
    private readonly snackBar = inject(MatSnackBar);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    private readonly tables = signal<ManagedTable[]>([]);
    private readonly connections = signal<Connection[]>([]);
    protected readonly settingsTables = computed<SettingsManagedTable[]>(() => this.tables().map((t) => ({
        id: t.id,
        schemaName: t.schemaName,
        tableName: t.tableName,
        displayName: t.displayName,
        description: t.description,
        connectionName: t.connectionName ?? undefined,
        color: t.color ?? t.connectionColor,
        sortOrder: t.sortOrder,
        enabled: t.enabled,
    })));
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
    protected readonly dialogConnections = computed<DialogConnection[]>(() => this.connections()
        .filter((c) => c.enabled)
        .map((c) => ({ id: c.id, name: c.name, schemaName: c.schemaName, color: c.color })));
    private editingConnId: number | null = null;
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            const [tables, connections] = await Promise.all([
                this.tablesApi.listTables(true),
                this.admin.listConnections(),
            ]);
            this.tables.set(tables);
            this.connections.set(connections);
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
    protected openRegister(): void {
        this.openManagedTableDialog({ mode: 'create', editValue: null }, null);
    }
    private usedSlugs(excludeId: number | null): string[] {
        return this.tables()
            .filter((t) => t.id !== excludeId)
            .map((t) => t.slug.toLowerCase());
    }
    protected openTableEdit(id: number): void {
        const t = this.tables().find((x) => x.id === id);
        if (!t)
            return;
        this.openManagedTableDialog({
            mode: 'edit',
            editValue: {
                schemaName: t.schemaName,
                tableName: t.tableName,
                connectionName: t.connectionName ?? undefined,
                displayName: t.displayName,
                slug: t.slug,
                description: t.description ?? '',
                color: t.color,
                connectionColor: t.connectionColor,
                readonlyColumns: t.readonlyColumns ?? [],
                hiddenColumns: t.hiddenColumns ?? [],
                fixedColumns: t.fixedColumns ?? [],
            },
        }, id);
    }
    private openManagedTableDialog(init: {
        mode: 'create' | 'edit';
        editValue: ManagedTableEditValue | null;
    }, editingTableId: number | null): void {
        const ref = openModal(this.dialog, ManagedTableDialog, {
            ...init,
            connections: this.dialogConnections(),
            usedSlugs: this.usedSlugs(editingTableId),
        }, { width: '47.5rem', maxWidth: '95vw' });
        const editConnId = editingTableId !== null
            ? (this.tables().find((x) => x.id === editingTableId)?.connectionId ??
                null)
            : null;
        let currentConnId = editConnId;
        const loadCandidates = async (connId: number | null): Promise<void> => {
            ref.componentRef?.setInput('loading', true);
            ref.componentRef?.setInput('candidates', []);
            try {
                const list = await this.admin.listSchemaTables(connId);
                ref.componentRef?.setInput('candidates', list.map((t) => ({
                    schemaName: t.schemaName,
                    tableName: t.tableName,
                    hasPrimaryKey: t.hasPrimaryKey,
                })));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
            finally {
                ref.componentRef?.setInput('loading', false);
            }
        };
        const loadPreview = async (schemaName: string, tableName: string): Promise<void> => {
            ref.componentRef?.setInput('preview', null);
            try {
                const p = await this.admin.previewSchemaTable(schemaName, tableName, currentConnId);
                ref.componentRef?.setInput('preview', {
                    primaryKey: p.primaryKey,
                    hasRowVersion: p.hasRowVersion,
                    columns: p.columns.map((c) => ({
                        name: c.name,
                        type: c.type,
                        nullable: c.nullable,
                        readonly: c.readonly,
                        required: c.required,
                        sqlType: c.sqlType,
                        unsupported: c.unsupported,
                    })),
                });
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
        };
        ref.componentInstance.connectionChanged.subscribe((connId: number | null) => {
            currentConnId = connId;
            ref.componentRef?.setInput('errorMessage', null);
            ref.componentRef?.setInput('preview', null);
            void loadCandidates(connId);
        });
        ref.componentInstance.candidateSelected.subscribe((e: {
            schemaName: string;
            tableName: string;
        }) => {
            void loadPreview(e.schemaName, e.tableName);
        });
        ref.componentInstance.confirmed.subscribe((e: ManagedTableRegistration) => {
            const fallbackKey = editingTableId !== null ? 'errors.saveFailed' : 'errors.registerFailed';
            void runDialogAction(this.transloco, ref, fallbackKey, async () => {
                if (editingTableId !== null) {
                    await this.admin.updateManagedTable(editingTableId, {
                        displayName: e.displayName,
                        slug: e.slug,
                        description: e.description ?? '',
                        color: e.color ?? '',
                        readonlyColumns: e.readonlyColumns,
                        hiddenColumns: e.hiddenColumns,
                        fixedColumns: e.fixedColumns,
                    });
                }
                else {
                    await this.admin.createManagedTable(e);
                }
                ref.close();
                await this.reload(true);
            });
        });
        if (init.mode === 'create') {
            void loadCandidates(null);
        }
        else if (init.editValue) {
            void loadPreview(init.editValue.schemaName, init.editValue.tableName);
        }
    }
    protected onTableToggled(e: {
        id: number;
        enabled: boolean;
    }): void {
        void this.run(async () => {
            await this.admin.updateManagedTable(e.id, { enabled: e.enabled });
        }, 'errors.updateFailed');
    }
    protected askTableDelete(id: number): void {
        const t = this.tables().find((x) => x.id === id);
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.unregisterTitle'),
            message: this.transloco.translate('confirms.unregisterMessage', {
                name: t?.displayName ?? id,
            }),
            danger: true,
        }, () => this.run(async () => {
            await this.admin.deleteManagedTable(id);
        }, 'errors.deleteFailed'));
    }
    protected onTabChanged(t: SettingsTab): void {
        this.tab.set(t);
        if (t === 'tablePermissions')
            void this.loadTableAuthCounts();
    }
    private async resolveTablesActionId(): Promise<number | null> {
        const cached = this.tablesActionId();
        if (cached !== null)
            return cached;
        const actions = await this.admin.listActions();
        const id = actions.find((a) => a.code === 'tables')?.id ?? null;
        this.tablesActionId.set(id);
        return id;
    }
    private async loadTableAuthCounts(): Promise<void> {
        try {
            const actionId = await this.resolveTablesActionId();
            const [entries, all] = await Promise.all([
                Promise.all(this.tables().map(async (t) => [t.id, countBySubject(await this.admin.listResourceAuth('managed_table', t.id))] as const)),
                actionId !== null ? this.admin.listResourceAuth('action', actionId) : Promise.resolve([]),
            ]);
            this.tableAuthCounts.set(Object.fromEntries(entries));
            this.allTablesAuthCount.set(countBySubject(all));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
    }
    protected openTableAuthDialog(tableId: number): void {
        const t = this.tables().find((x) => x.id === tableId);
        if (!t)
            return;
        this.openResourceAuthDialog('managed_table', tableId, t.displayName, (c) => this.tableAuthCounts.update((m) => ({ ...m, [tableId]: c })));
    }
    protected openAllTablesAuthDialog(): void {
        void (async () => {
            const actionId = await this.resolveTablesActionId();
            if (actionId === null)
                return;
            this.openResourceAuthDialog('action', actionId, this.transloco.translate('settings.allTablesRow'), (c) => this.allTablesAuthCount.set(c));
        })();
    }
    private openResourceAuthDialog(type: ResourceType, id: number, title: string, onCount: (c: TableAuthCount) => void): void {
        const ref = openModal(this.dialog, ResourceAuthDialog, { title }, { width: '30rem', maxWidth: '95vw' });
        const setEntries = (entries: ResourceAuthEntryView[]): void => {
            ref.componentRef?.setInput('entries', entries);
            onCount(countBySubject(entries));
        };
        const load = async (): Promise<void> => {
            ref.componentRef?.setInput('loading', true);
            try {
                const [entries, users, groups] = await Promise.all([
                    this.admin.listResourceAuth(type, id),
                    this.admin.listUsers({ limit: 1000, offset: 0 }),
                    this.admin.listGroups(),
                ]);
                setEntries(entries);
                const options: SubjectOption[] = [
                    ...users.users.map((u): SubjectOption => ({
                        subjectKind: 'user',
                        subjectId: u.objectGuid,
                        name: u.displayName,
                        username: u.username,
                    })),
                    ...groups.map((g): SubjectOption => ({
                        subjectKind: 'group',
                        subjectId: String(g.id),
                        name: g.name,
                    })),
                ];
                ref.componentRef?.setInput('subjectOptions', options);
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
            finally {
                ref.componentRef?.setInput('loading', false);
            }
        };
        const mutate = async (run: () => Promise<unknown>): Promise<void> => {
            ref.componentRef?.setInput('saving', true);
            ref.componentRef?.setInput('errorMessage', null);
            try {
                await run();
                setEntries(await this.admin.listResourceAuth(type, id));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.updateFailed'));
            }
            finally {
                ref.componentRef?.setInput('saving', false);
            }
        };
        ref.componentInstance.levelChanged.subscribe((e: SubjectRef & {
            authLevel: DialogResourceAuthLevel;
        }) => {
            void mutate(() => this.admin.setResourceAuth(type, id, e.subjectKind, e.subjectId, e.authLevel));
        });
        ref.componentInstance.addClicked.subscribe((e: SubjectRef) => {
            void mutate(() => this.admin.setResourceAuth(type, id, e.subjectKind, e.subjectId, 'r'));
        });
        ref.componentInstance.removeClicked.subscribe((e: SubjectRef) => {
            void mutate(() => this.admin.deleteResourceAuth(type, id, e.subjectKind, e.subjectId));
        });
        void load();
    }
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
function countBySubject(entries: {
    subjectKind: string;
}[]): TableAuthCount {
    let users = 0;
    let groups = 0;
    for (const e of entries) {
        if (e.subjectKind === 'group')
            groups++;
        else
            users++;
    }
    return { users, groups };
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
