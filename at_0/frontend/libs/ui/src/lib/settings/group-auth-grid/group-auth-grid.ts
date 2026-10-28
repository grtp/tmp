import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
import { UserLevelChange, UsersGridAction } from '../users-grid/users-grid';
export interface SettingsGroupAuth {
    id: number;
    name: string;
    groupName?: string;
    description?: string;
    levels: Record<number, string>;
}
export interface GroupLevelChange {
    groupId: number;
    actionId: number;
    level: UserLevelChange['level'];
}
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-group-auth-grid',
    imports: [DataTablePage, MatButtonModule, MatIcon, MatMenuModule],
    templateUrl: './group-auth-grid.html',
    styleUrl: './group-auth-grid.css',
})
export class GroupAuthGrid {
    private transloco = inject(TranslocoService);
    readonly groups = input<SettingsGroupAuth[]>([]);
    readonly actions = input<UsersGridAction[]>([]);
    readonly loading = input(false);
    readonly showUngranted = input(false);
    readonly levelChanged = output<GroupLevelChange>();
    readonly showUngrantedChange = output<boolean>();
    readonly addClicked = output<void>();
    readonly clearClicked = output<number>();
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly groupTpl = viewChild<TemplateRef<CellContext>>('groupTpl');
    private readonly levelTpl = viewChild<TemplateRef<CellContext>>('levelTpl');
    private readonly opsTpl = viewChild<TemplateRef<CellContext>>('opsTpl');
    protected readonly title = computed(() => this.t('settings.tabGroupPermissions'));
    protected readonly columnDefs = computed<ColumnDef[]>(() => [
        { key: 'group', label: this.t('settings.thGroupName'), template: this.groupTpl() },
        ...this.actions().map((a) => ({
            key: `a${a.id}`,
            label: a.name,
            template: this.levelTpl(),
            meta: a.id,
        })),
        { key: 'ops', label: this.t('settings.thOps'), template: this.opsTpl() },
    ]);
    protected readonly displayRows = computed<TableRow[]>(() => this.groups().map((g, i) => ({
        [ROW_INDEX_KEY]: i,
        group: '',
        ops: '',
    })));
    protected rowOf(display: TableRow): SettingsGroupAuth | undefined {
        const i = display[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.groups()[i] : undefined;
    }
    protected readonly LEVELS: UserLevelChange['level'][] = ['', 'user', 'maintainer', 'admin'];
    protected levelOf(display: TableRow, col: ColumnDef): string {
        const g = this.rowOf(display);
        return g?.levels[col.meta as number] || '';
    }
    protected hasAny(display: TableRow): boolean {
        const g = this.rowOf(display);
        return !!g && Object.values(g.levels).some((l) => l !== '');
    }
    protected levelLabel(level: string): string {
        switch (level) {
            case 'user':
                return this.t('settings.levelUser');
            case 'maintainer':
                return this.t('settings.levelMaintainer');
            case 'admin':
                return this.t('settings.levelAdmin');
            default:
                return this.t('settings.levelNone');
        }
    }
    protected onLevelChange(display: TableRow, col: ColumnDef, level: string): void {
        const g = this.rowOf(display);
        if (!g)
            return;
        this.levelChanged.emit({
            groupId: g.id,
            actionId: col.meta as number,
            level: level as UserLevelChange['level'],
        });
    }
    protected onClear(display: TableRow): void {
        const g = this.rowOf(display);
        if (g)
            this.clearClicked.emit(g.id);
    }
}
