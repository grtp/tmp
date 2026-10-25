import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, signal, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
import { FilterColumn, FilterPredicate, } from '../../shared/filter-bar/filter-model';
export interface SettingsUser {
    objectGuid: string;
    username: string;
    displayName: string;
    levels: Record<number, string>;
}
export interface UserLevelChange {
    objectGuid: string;
    actionId: number;
    level: '' | 'user' | 'maintainer' | 'admin';
}
export interface UsersGridAction {
    id: number;
    code: string;
    name: string;
}
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-users-grid',
    imports: [DataTablePage, MatButtonModule, MatIcon, MatMenuModule],
    templateUrl: './users-grid.html',
    styleUrl: './users-grid.css',
})
export class UsersGrid {
    private transloco = inject(TranslocoService);
    readonly users = input<SettingsUser[]>([]);
    readonly actions = input<UsersGridAction[]>([]);
    readonly totalCount = input(0);
    readonly page = input(1);
    readonly pageSize = input(50);
    readonly loading = input(false);
    readonly predicates = input<FilterPredicate[]>([]);
    readonly showUngranted = input(false);
    readonly levelChanged = output<UserLevelChange>();
    readonly predicatesChange = output<FilterPredicate[]>();
    readonly pageChanged = output<number>();
    readonly pageSizeChanged = output<number>();
    readonly showUngrantedChange = output<boolean>();
    readonly addClicked = output<void>();
    readonly clearClicked = output<string>();
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly userTpl = viewChild<TemplateRef<CellContext>>('userTpl');
    private readonly levelTpl = viewChild<TemplateRef<CellContext>>('levelTpl');
    private readonly opsTpl = viewChild<TemplateRef<CellContext>>('opsTpl');
    protected readonly columnDefs = computed<ColumnDef[]>(() => [
        { key: 'user', label: this.t('settings.thUser'), template: this.userTpl() },
        ...this.actions().map((a) => ({
            key: `a${a.id}`,
            label: a.name,
            template: this.levelTpl(),
            meta: a.id,
        })),
        { key: 'ops', label: this.t('settings.thOps'), template: this.opsTpl() },
    ]);
    protected readonly title = computed(() => this.t('settings.tabUsers'));
    protected readonly filterColumns = computed<FilterColumn[]>(() => {
        const levels = [
            { value: 'user', label: this.t('settings.levelUser') },
            { value: 'maintainer', label: this.t('settings.levelMaintainer') },
            { value: 'admin', label: this.t('settings.levelAdmin') },
        ];
        return [
            { key: 'username', label: this.t('settings.thUserId'), type: 'string' },
            { key: 'displayName', label: this.t('settings.thDisplayName'), type: 'string' },
            ...this.actions().map((a): FilterColumn => ({
                key: `auth:${a.code}`,
                label: a.name,
                type: 'enum',
                enumValues: levels,
            })),
        ];
    });
    protected readonly displayRows = computed<TableRow[]>(() => this.users().map((u, i) => ({
        [ROW_INDEX_KEY]: i,
        user: '',
        ops: '',
    })));
    protected rowOf(display: TableRow): SettingsUser | undefined {
        const i = display[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.users()[i] : undefined;
    }
    protected readonly LEVELS: UserLevelChange['level'][] = [
        '',
        'user',
        'maintainer',
        'admin',
    ];
    protected levelOf(display: TableRow, col: ColumnDef): string {
        const u = this.rowOf(display);
        return u?.levels[col.meta as number] || '';
    }
    protected hasAny(display: TableRow): boolean {
        const u = this.rowOf(display);
        return !!u && Object.values(u.levels).some((l) => l !== '');
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
        const u = this.rowOf(display);
        if (!u)
            return;
        this.levelChanged.emit({
            objectGuid: u.objectGuid,
            actionId: col.meta as number,
            level: level as UserLevelChange['level'],
        });
    }
    protected onClear(display: TableRow): void {
        const u = this.rowOf(display);
        if (u)
            this.clearClicked.emit(u.objectGuid);
    }
    protected readonly storageKey = signal('ftool.colw:settings:users');
}
