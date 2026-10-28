import { ChangeDetectionStrategy, Component, inject, signal, } from '@angular/core';
import { Router } from '@angular/router';
import { TableCard, TableSelectPage } from '@f-tool/ui';
import { TablesApi } from '../../core/api/tables-api';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-table-select-container',
    styles: ':host { display: contents; }',
    imports: [TableSelectPage],
    templateUrl: './table-select-container.html',
})
export class TableSelectContainer {
    protected readonly router = inject(Router);
    private api = inject(TablesApi);
    protected readonly loading = signal(true);
    protected readonly cards = signal<TableCard[]>([]);
    private slugsById = new Map<number, string>();
    constructor() {
        void this.load();
    }
    private async load(): Promise<void> {
        try {
            const tables = await this.api.listTables();
            this.slugsById = new Map(tables.map((t) => [t.id, t.slug]));
            this.cards.set(tables.map((t) => ({
                id: t.id,
                displayName: t.displayName,
                schemaName: t.schemaName,
                tableName: t.tableName,
                description: t.description,
                connectionName: t.connectionName ?? undefined,
                color: t.color ?? t.connectionColor,
            })));
        }
        finally {
            this.loading.set(false);
        }
    }
    protected open(id: number): void {
        this.router.navigate(['/tables', this.slugsById.get(id) ?? '']);
    }
}
