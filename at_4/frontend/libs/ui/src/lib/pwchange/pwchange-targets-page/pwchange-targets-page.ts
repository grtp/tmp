import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { contrastTextColor } from '../../shared/color';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
export interface PwchangeTargetRow {
    id: number;
    connectionName: string;
    connectionColor?: string;
    schemaName: string;
    tableName: string;
    idColumn: string;
    passwordColumn: string;
    recipeSummary: string;
    saltSet: boolean;
    maxFailures: number;
    lockMinutes: number;
    policySummary: string;
    enabled: boolean;
    recentFailures: number;
}
export interface PwchangeAuthCount {
    users: number;
    groups: number;
}
const NO_AUTH: PwchangeAuthCount = { users: 0, groups: 0 };
export type PwchangeTargetsTab = 'targets' | 'permissions';
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-pwchange-targets-page',
    imports: [DataTablePage, MatButtonModule, MatCheckboxModule, MatIcon, MatTabsModule, TranslocoPipe],
    templateUrl: './pwchange-targets-page.html',
    styleUrl: './pwchange-targets-page.css',
})
export class PwchangeTargetsPage {
    readonly targets = input<PwchangeTargetRow[]>([]);
    readonly loading = input(false);
    readonly alertThreshold = input(20);
    readonly activeTab = input<PwchangeTargetsTab>('targets');
    readonly showPermissions = input(false);
    readonly authCounts = input<Record<number, PwchangeAuthCount>>({});
    readonly allAuthCount = input<PwchangeAuthCount>(NO_AUTH);
    readonly tabChanged = output<PwchangeTargetsTab>();
    readonly addClicked = output<void>();
    readonly editClicked = output<number>();
    readonly deleteClicked = output<number>();
    readonly toggled = output<{
        id: number;
        enabled: boolean;
    }>();
    readonly permissionClicked = output<number>();
    readonly allPermissionClicked = output<void>();
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    private t(key: string, params?: Record<string, unknown>): string {
        void this.lang();
        return this.transloco.translate(key, params);
    }
    protected readonly contrastTextColor = contrastTextColor;
    protected readonly tabs = computed<PwchangeTargetsTab[]>(() => this.showPermissions() ? ['targets', 'permissions'] : ['targets']);
    protected tabLabelKey(t: PwchangeTargetsTab): string {
        return t === 'permissions' ? 'settings.tabPwchangePermissions' : 'pwchangeTargets.title';
    }
    protected tabIcon(t: PwchangeTargetsTab): string {
        return t === 'permissions' ? 'lock_person' : 'password';
    }
    private readonly connTpl = viewChild<TemplateRef<CellContext>>('connTpl');
    private readonly saltTpl = viewChild<TemplateRef<CellContext>>('saltTpl');
    private readonly enabledTpl = viewChild<TemplateRef<CellContext>>('enabledTpl');
    private readonly opsTpl = viewChild<TemplateRef<CellContext>>('opsTpl');
    private readonly permNameTpl = viewChild<TemplateRef<CellContext>>('permNameTpl');
    private readonly permUsersTpl = viewChild<TemplateRef<CellContext>>('permUsersTpl');
    private readonly permGroupsTpl = viewChild<TemplateRef<CellContext>>('permGroupsTpl');
    protected rowOf(row: TableRow): PwchangeTargetRow | undefined {
        const i = row[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.targets()[i] : undefined;
    }
    protected readonly cols = computed<ColumnDef[]>(() => [
        { key: 'conn', label: this.t('pwchangeTargets.thConnection'), template: this.connTpl() },
        { key: 'table', label: this.t('pwchangeTargets.thTable'), mono: true },
        { key: 'idColumn', label: this.t('pwchangeTargets.thIdColumn'), mono: true },
        { key: 'passwordColumn', label: this.t('pwchangeTargets.thPasswordColumn'), mono: true },
        { key: 'recipe', label: this.t('pwchangeTargets.thRecipe'), mono: true },
        { key: 'salt', label: this.t('pwchangeTargets.thSalt'), template: this.saltTpl() },
        { key: 'lock', label: this.t('pwchangeTargets.thLock') },
        { key: 'policy', label: this.t('pwchangeTargets.thPolicy') },
        { key: 'enabled', label: this.t('settings.thEnabled'), template: this.enabledTpl() },
        { key: 'ops', label: this.t('settings.thOps'), template: this.opsTpl() },
    ]);
    protected readonly rows = computed<TableRow[]>(() => this.targets().map((x, i) => ({
        [ROW_INDEX_KEY]: i,
        conn: '',
        table: `${x.schemaName}.${x.tableName}`,
        idColumn: x.idColumn,
        passwordColumn: x.passwordColumn,
        recipe: x.recipeSummary,
        salt: '',
        lock: this.t('pwchangeTargets.lockSummary', { n: x.maxFailures, min: x.lockMinutes }),
        policy: x.policySummary,
        enabled: '',
        ops: '',
    })));
    protected onRowSelected(row: TableRow): void {
        const x = this.rowOf(row);
        if (x)
            this.editClicked.emit(x.id);
    }
    protected readonly permCols = computed<ColumnDef[]>(() => [
        { key: 'conn', label: this.t('settings.thConnection'), template: this.permNameTpl() },
        { key: 'table', label: this.t('settings.thPhysicalTable'), mono: true },
        { key: 'users', label: this.t('settings.thGrantedUsers'), template: this.permUsersTpl() },
        { key: 'groups', label: this.t('settings.thGrantedGroups'), template: this.permGroupsTpl() },
    ]);
    protected readonly permRows = computed<TableRow[]>(() => [
        { [ROW_INDEX_KEY]: -1, conn: this.t('settings.allConnectionsRow'), table: '*', users: '', groups: '' },
        ...this.targets().map((x, i) => ({
            [ROW_INDEX_KEY]: i,
            conn: x.connectionName,
            table: `${x.schemaName}.${x.tableName}`,
            users: '',
            groups: '',
        })),
    ]);
    protected isAllRow(row: TableRow): boolean {
        return row[ROW_INDEX_KEY] === -1;
    }
    protected authCountOf(row: TableRow): PwchangeAuthCount {
        if (this.isAllRow(row))
            return this.allAuthCount();
        const x = this.rowOf(row);
        return x ? (this.authCounts()[x.id] ?? NO_AUTH) : NO_AUTH;
    }
    protected onPermRowSelected(row: TableRow): void {
        if (this.isAllRow(row)) {
            this.allPermissionClicked.emit();
            return;
        }
        const x = this.rowOf(row);
        if (x)
            this.permissionClicked.emit(x.id);
    }
}
