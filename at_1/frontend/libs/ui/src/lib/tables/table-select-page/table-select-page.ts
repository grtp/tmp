import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
export interface TableCard {
    id: number;
    displayName: string;
    schemaName: string;
    tableName: string;
    description?: string;
    connectionName?: string;
    createdAt: string;
    lastActivityAt?: string;
}
type ViewMode = 'card' | 'list';
const VIEW_MODE_KEY = 'ftool.tableSelect.view';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-table-select-page',
    imports: [DatePipe, MatIcon, TranslocoPipe],
    templateUrl: './table-select-page.html',
    styleUrl: './table-select-page.css',
})
export class TableSelectPage {
    readonly tables = input<TableCard[]>([]);
    readonly loading = input(false);
    readonly canManage = input(false);
    readonly tableSelected = output<number>();
    readonly manageClicked = output<void>();
    protected readonly query = signal('');
    protected readonly view = signal<ViewMode>(this.loadView());
    protected readonly filtered = computed(() => {
        const q = this.query().trim().toLowerCase();
        if (q === '')
            return this.tables();
        return this.tables().filter((t) => {
            const hay = `${t.displayName} ${t.schemaName}.${t.tableName}`.toLowerCase();
            return hay.includes(q);
        });
    });
    protected onQueryInput(e: Event): void {
        this.query.set((e.target as HTMLInputElement).value);
    }
    protected setView(v: ViewMode): void {
        this.view.set(v);
        try {
            localStorage.setItem(VIEW_MODE_KEY, v);
        }
        catch {
        }
    }
    private loadView(): ViewMode {
        try {
            return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'card';
        }
        catch {
            return 'card';
        }
    }
}
