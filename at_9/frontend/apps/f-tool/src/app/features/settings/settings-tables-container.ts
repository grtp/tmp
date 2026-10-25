import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { CandidatePreview, DialogConnection, ManagedTableEditValue, ManagedTableDialog, ManagedTableRegistration, ResourceAuthDialog, ResourceAuthEntryView, ResourceAuthLevel as DialogResourceAuthLevel, SettingsManagedTable, SettingsPage, SettingsTab, SubjectRef, TableAuthCount, refKeyOf, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { createReloadRunner } from '../../core/reload-action';
import { SubjectPickerHandle, openSubjectPicker } from '../../core/subject-picker';
import { AdminApi } from '../../core/api/admin-api';
import { TablesApi } from '../../core/api/tables-api';
import { Connection, ManagedTable, ResourceType, SchemaTablePreview, ResourceAuthEntry } from '../../core/models';
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
    ]);
    protected readonly tab = signal<SettingsTab>('tables');
    protected readonly loading = signal(false);
    protected readonly tableAuthCounts = signal<Record<number, TableAuthCount>>({});
    protected readonly allTablesAuthCount = signal<TableAuthCount>({ users: 0, groups: 0 });
    private readonly tablesActionId = signal<number | null>(null);
    private readonly dialog = inject(MatDialog);
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
    protected readonly dialogConnections = computed<DialogConnection[]>(() => this.connections()
        .filter((c) => c.enabled)
        .map((c) => ({ id: c.id, name: c.name, schemaName: c.schemaName, color: c.color })));
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
                lookups: t.lookups ?? [],
                columnOrder: t.columnOrder ?? [],
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
        }, { width: '64rem', maxWidth: '95vw' });
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
        const toPreview = (p: SchemaTablePreview): CandidatePreview => ({
            primaryKey: p.primaryKey,
            hasRowVersion: p.hasRowVersion,
            uniqueKeys: p.uniqueKeys ?? [],
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
        const loadPreview = async (schemaName: string, tableName: string): Promise<void> => {
            ref.componentRef?.setInput('preview', null);
            try {
                const p = await this.admin.previewSchemaTable(schemaName, tableName, currentConnId);
                ref.componentRef?.setInput('preview', toPreview(p));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
        };
        let refPreviews: Record<string, CandidatePreview> = {};
        const loadRefCandidates = async (connId: number | null): Promise<void> => {
            refPreviews = {};
            ref.componentRef?.setInput('refPreviews', refPreviews);
            ref.componentRef?.setInput('refCandidates', []);
            try {
                const list = await this.admin.listSchemaTables(connId, undefined, true);
                ref.componentRef?.setInput('refCandidates', list.map((t) => ({
                    schemaName: t.schemaName,
                    tableName: t.tableName,
                    hasPrimaryKey: t.hasPrimaryKey,
                })));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
        };
        const loadRefPreview = async (schemaName: string, tableName: string): Promise<void> => {
            const key = refKeyOf(schemaName, tableName);
            if (refPreviews[key])
                return;
            try {
                const p = await this.admin.previewSchemaTable(schemaName, tableName, currentConnId);
                refPreviews = { ...refPreviews, [key]: toPreview(p) };
                ref.componentRef?.setInput('refPreviews', refPreviews);
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
            void loadRefCandidates(connId);
        });
        ref.componentInstance.candidateSelected.subscribe((e: {
            schemaName: string;
            tableName: string;
        }) => {
            void loadPreview(e.schemaName, e.tableName);
        });
        ref.componentInstance.refTableSelected.subscribe((e: {
            schemaName: string;
            tableName: string;
        }) => {
            void loadRefPreview(e.schemaName, e.tableName);
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
                        lookups: e.lookups,
                        columnOrder: e.columnOrder,
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
            void loadRefCandidates(null);
        }
        else if (init.editValue) {
            void loadPreview(init.editValue.schemaName, init.editValue.tableName);
            void loadRefCandidates(editConnId);
            for (const l of init.editValue.lookups) {
                void loadRefPreview(l.refSchema, l.refTable);
            }
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
        let picker: SubjectPickerHandle | null = null;
        let current: ResourceAuthEntryView[] = [];
        const setEntries = (entries: ResourceAuthEntryView[]): void => {
            current = entries;
            ref.componentRef?.setInput('entries', entries);
            picker?.setExcluded(entries);
            onCount(countBySubject(entries));
        };
        const load = async (): Promise<void> => {
            ref.componentRef?.setInput('loading', true);
            try {
                setEntries(withGroupKey(await this.admin.listResourceAuth(type, id)));
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
                setEntries(withGroupKey(await this.admin.listResourceAuth(type, id)));
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
        ref.componentInstance.addClicked.subscribe(() => {
            const h = openSubjectPicker(this.dialog, this.admin, this.transloco, {
                titleKey: 'resourceAuthDialog.addSubject',
                name: title,
                excluded: current,
                add: (s) => this.admin.setResourceAuth(type, id, s.subjectKind, s.subjectId, 'r'),
                afterChange: async () => setEntries(withGroupKey(await this.admin.listResourceAuth(type, id))),
            });
            picker = h;
            h.ref.afterClosed().subscribe(() => {
                if (picker === h)
                    picker = null;
            });
        });
        ref.componentInstance.removeClicked.subscribe((e: SubjectRef) => {
            void mutate(() => this.admin.deleteResourceAuth(type, id, e.subjectKind, e.subjectId));
        });
        void load();
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
function withGroupKey(entries: ResourceAuthEntry[]): ResourceAuthEntryView[] {
    return entries.map((e) => ({ ...e, username: e.username ?? e.groupName }));
}
