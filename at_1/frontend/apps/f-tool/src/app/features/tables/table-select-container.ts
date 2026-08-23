import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { Router } from '@angular/router';
import { TableCard, TableSelectPage } from '@f-tool/ui';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
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
    private auth = inject(AuthService);
    protected readonly loading = signal(true);
    protected readonly cards = signal<TableCard[]>([]);
    protected readonly canManage = computed(() => this.auth.allows('settings', 'admin'));
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
                createdAt: t.createdAt,
                lastActivityAt: t.lastActivityAt ?? undefined,
            })));
        }
        finally {
            this.loading.set(false);
        }
    }
    protected open(id: number): void {
        this.router.navigate(['/tables', this.slugsById.get(id) ?? '']);
    }
    protected openManage(): void {
        this.router.navigate(['/settings/tables']);
    }
}
