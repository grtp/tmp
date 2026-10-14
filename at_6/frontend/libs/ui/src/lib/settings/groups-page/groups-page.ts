import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, input, output, viewChild, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CellContext, ColumnDef, DataTablePage, TableRow, } from '../../tables/data-table-page/data-table-page';
export interface SettingsGroup {
    id: number;
    name: string;
    description?: string;
    memberCount: number;
}
const ROW_INDEX_KEY = '$i';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-groups-page',
    imports: [DataTablePage, MatButtonModule, MatIcon, TranslocoPipe],
    templateUrl: './groups-page.html',
    styleUrl: './groups-page.css',
})
export class GroupsPage {
    private transloco = inject(TranslocoService);
    readonly groups = input<SettingsGroup[]>([]);
    readonly loading = input(false);
    readonly addClicked = output<void>();
    readonly editClicked = output<number>();
    readonly deleteClicked = output<number>();
    private readonly lang = toSignal(this.transloco.selectTranslation());
    private t(key: string): string {
        void this.lang();
        return this.transloco.translate(key);
    }
    private readonly nameTpl = viewChild<TemplateRef<CellContext>>('nameTpl');
    private readonly opsTpl = viewChild<TemplateRef<CellContext>>('opsTpl');
    protected readonly title = computed(() => this.t('settings.groupsTitle'));
    protected readonly columnDefs = computed<ColumnDef[]>(() => [
        { key: 'name', label: this.t('settings.thGroupName'), template: this.nameTpl() },
        { key: 'description', label: this.t('settings.thDescription') },
        { key: 'members', label: this.t('settings.thMembers') },
        { key: 'ops', label: this.t('settings.thOps'), template: this.opsTpl() },
    ]);
    protected readonly displayRows = computed<TableRow[]>(() => this.groups().map((g, i) => ({
        [ROW_INDEX_KEY]: i,
        name: '',
        description: g.description ?? '',
        members: String(g.memberCount),
        ops: '',
    })));
    protected rowOf(display: TableRow): SettingsGroup | undefined {
        const i = display[ROW_INDEX_KEY];
        return typeof i === 'number' ? this.groups()[i] : undefined;
    }
    protected onRowSelected(row: TableRow): void {
        const g = this.rowOf(row);
        if (g)
            this.editClicked.emit(g.id);
    }
}
