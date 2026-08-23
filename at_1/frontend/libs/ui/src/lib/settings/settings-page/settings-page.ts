import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
export type SettingsTab = 'tables' | 'connections' | 'users' | 'actions';
export interface SettingsManagedTable {
    id: number;
    schemaName: string;
    tableName: string;
    displayName: string;
    description?: string;
    connectionName?: string;
    sortOrder: number;
    enabled: boolean;
}
export interface SettingsConnection {
    id: number;
    name: string;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    schemaName?: string;
    enabled: boolean;
}
export interface SettingsAction {
    id: number;
    code: string;
    name: string;
    icon: string;
    sortOrder: number;
    enabled: boolean;
}
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-page',
    imports: [
        DataTablePage,
        MatButtonModule,
        MatCheckboxModule,
        MatIcon,
        MatTabsModule,
        TranslocoPipe,
    ],
    templateUrl: './settings-page.html',
    styleUrl: './settings-page.css',
})
export class SettingsPage {
    readonly activeTab = input<SettingsTab>('tables');
    readonly visibleTabs = input<SettingsTab[]>([
        'tables',
        'connections',
        'users',
        'actions',
    ]);
    readonly managedTables = input<SettingsManagedTable[]>([]);
    readonly connections = input<SettingsConnection[]>([]);
    readonly actions = input<SettingsAction[]>([]);
    readonly loading = input(false);
    readonly tabChanged = output<SettingsTab>();
    readonly registerClicked = output<void>();
    readonly tableEditClicked = output<number>();
    readonly tableToggled = output<{
        id: number;
        enabled: boolean;
    }>();
    readonly tableDeleteClicked = output<number>();
    readonly connectionAddClicked = output<void>();
    readonly connectionEditClicked = output<number>();
    readonly connectionToggled = output<{
        id: number;
        enabled: boolean;
    }>();
    readonly connectionDeleteClicked = output<number>();
    readonly connectionTestClicked = output<number>();
    readonly actionToggled = output<{
        id: number;
        enabled: boolean;
    }>();
    protected tabIcon(t: SettingsTab): string {
        switch (t) {
            case 'tables':
                return 'table_view';
            case 'connections':
                return 'cable';
            case 'users':
                return 'group';
            case 'actions':
                return 'apps';
        }
    }
    protected tabLabelKey(t: SettingsTab): string {
        switch (t) {
            case 'tables':
                return 'settings.tabTables';
            case 'connections':
                return 'settings.tabConnections';
            case 'users':
                return 'settings.tabUsers';
            case 'actions':
                return 'settings.tabActions';
        }
    }
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    private t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly tableConnTpl = viewChild<TemplateRef<CellContext>>('tableConnTpl');
    private readonly tableVisibleTpl = viewChild<TemplateRef<CellContext>>('tableVisibleTpl');
    private readonly tableOpsTpl = viewChild<TemplateRef<CellContext>>('tableOpsTpl');
    private readonly connEnabledTpl = viewChild<TemplateRef<CellContext>>('connEnabledTpl');
    private readonly connOpsTpl = viewChild<TemplateRef<CellContext>>('connOpsTpl');
    private readonly actionIconTpl = viewChild<TemplateRef<CellContext>>('actionIconTpl');
    private readonly actionEnabledTpl = viewChild<TemplateRef<CellContext>>('actionEnabledTpl');
    private atIndex<T>(list: T[], row: TableRow): T | undefined {
        const i = row[ROW_INDEX_KEY];
        return typeof i === 'number' ? list[i] : undefined;
    }
    protected tableOf(row: TableRow): SettingsManagedTable | undefined {
        return this.atIndex(this.managedTables(), row);
    }
    protected connOf(row: TableRow): SettingsConnection | undefined {
        return this.atIndex(this.connections(), row);
    }
    protected actionOf(row: TableRow): SettingsAction | undefined {
        return this.atIndex(this.actions(), row);
    }
    protected readonly tablesCols = computed<ColumnDef[]>(() => [
        { key: 'displayName', label: this.t('settings.thDisplayName') },
        { key: 'conn', label: this.t('settings.thConnection'), template: this.tableConnTpl() },
        { key: 'physical', label: this.t('settings.thPhysicalTable'), mono: true },
        { key: 'description', label: this.t('settings.thDescription') },
        { key: 'enabled', label: this.t('settings.thVisible'), template: this.tableVisibleTpl() },
        { key: 'ops', label: this.t('settings.thOps'), template: this.tableOpsTpl() },
    ]);
    protected readonly tablesRows = computed<TableRow[]>(() => this.managedTables().map((t, i) => ({
        [ROW_INDEX_KEY]: i,
        displayName: t.displayName,
        conn: '',
        physical: `${t.schemaName}.${t.tableName}`,
        description: t.description ?? '',
        enabled: '',
        ops: '',
    })));
    protected onTableRowSelected(row: TableRow): void {
        const t = this.tableOf(row);
        if (t)
            this.tableEditClicked.emit(t.id);
    }
    protected onConnRowSelected(row: TableRow): void {
        const cn = this.connOf(row);
        if (cn)
            this.connectionEditClicked.emit(cn.id);
    }
    protected readonly connectionsCols = computed<ColumnDef[]>(() => [
        { key: 'name', label: this.t('settings.thName') },
        { key: 'host', label: this.t('settings.thHost'), mono: true },
        { key: 'databaseName', label: this.t('settings.thDatabase'), mono: true },
        { key: 'username', label: this.t('settings.thUsername'), mono: true },
        { key: 'schema', label: this.t('settings.thSchema'), mono: true },
        { key: 'enabled', label: this.t('settings.thEnabled'), template: this.connEnabledTpl() },
        { key: 'ops', label: this.t('settings.thOps'), template: this.connOpsTpl() },
    ]);
    protected readonly connectionsRows = computed<TableRow[]>(() => this.connections().map((cn, i) => ({
        [ROW_INDEX_KEY]: i,
        name: cn.name,
        host: `${cn.host}:${cn.port}`,
        databaseName: cn.databaseName,
        username: cn.username,
        schema: cn.schemaName || this.t('settings.schemaUnrestricted'),
        enabled: '',
        ops: '',
    })));
    protected readonly actionsCols = computed<ColumnDef[]>(() => [
        { key: 'code', label: this.t('settings.thCode'), mono: true },
        { key: 'name', label: this.t('settings.thName') },
        { key: 'icon', label: this.t('settings.thIcon'), template: this.actionIconTpl() },
        { key: 'enabled', label: this.t('settings.thEnabled'), template: this.actionEnabledTpl() },
    ]);
    protected readonly actionsRows = computed<TableRow[]>(() => this.actions().map((a, i) => ({
        [ROW_INDEX_KEY]: i,
        code: a.code,
        name: a.name,
        icon: '',
        enabled: '',
    })));
}
