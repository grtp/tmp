import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
import { FilterColumn, FilterPredicate } from '../../shared/filter-bar/filter-model';
export interface LedgerUser {
    objectGuid: string;
    username: string;
    displayName: string;
    employeeNo?: string;
    department?: string;
    title?: string;
    email?: string;
    lastLoginAt?: string;
}
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-user-ledger',
    imports: [DataTablePage, MatButtonModule, MatIcon, TranslocoPipe],
    templateUrl: './user-ledger.html',
    styleUrl: './user-ledger.css',
})
export class UserLedger {
    private transloco = inject(TranslocoService);
    readonly users = input<LedgerUser[]>([]);
    readonly totalCount = input(0);
    readonly page = input(1);
    readonly pageSize = input(50);
    readonly loading = input(false);
    readonly predicates = input<FilterPredicate[]>([]);
    readonly predicatesChange = output<FilterPredicate[]>();
    readonly pageChanged = output<number>();
    readonly pageSizeChanged = output<number>();
    readonly deleteClicked = output<string>();
    readonly addFromAdClicked = output<void>();
    readonly rowClicked = output<string>();
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly userTpl = viewChild<TemplateRef<CellContext>>('userTpl');
    private readonly opsTpl = viewChild<TemplateRef<CellContext>>('opsTpl');
    protected readonly title = computed(() => this.t('users.ledgerTitle'));
    protected readonly columnDefs = computed<ColumnDef[]>(() => [
        { key: 'employeeNo', label: this.t('users.thEmployeeNo'), mono: true },
        { key: 'user', label: this.t('users.thUser'), template: this.userTpl() },
        { key: 'title', label: this.t('users.thTitle') },
        { key: 'department', label: this.t('users.thDepartment') },
        { key: 'lastLoginAt', label: this.t('users.thLastLogin') },
        { key: 'ops', label: this.t('settings.thOps'), template: this.opsTpl() },
    ]);
    protected readonly filterColumns = computed<FilterColumn[]>(() => [
        { key: 'username', label: this.t('users.thUserId'), type: 'string' },
        { key: 'displayName', label: this.t('users.thDisplayName'), type: 'string' },
        { key: 'employeeNo', label: this.t('users.thEmployeeNo'), type: 'string' },
        { key: 'department', label: this.t('users.thDepartment'), type: 'string' },
        { key: 'title', label: this.t('users.thTitle'), type: 'string' },
        { key: 'email', label: this.t('users.thEmail'), type: 'string' },
        { key: 'lastLoginAt', label: this.t('users.thLastLogin'), type: 'datetime' },
    ]);
    protected readonly displayRows = computed<TableRow[]>(() => this.users().map((u, i) => ({
        [ROW_INDEX_KEY]: i,
        user: '',
        employeeNo: u.employeeNo ?? '',
        department: u.department ?? '',
        title: u.title ?? '',
        lastLoginAt: u.lastLoginAt ?? '-',
        ops: '',
    })));
    protected rowOf(display: TableRow): LedgerUser | undefined {
        const i = display[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.users()[i] : undefined;
    }
    protected onRowSelected(row: TableRow): void {
        const u = this.rowOf(row);
        if (u)
            this.rowClicked.emit(u.objectGuid);
    }
}
