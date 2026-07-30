// features/table-maint — 入口: 編集対象テーブルをカードで選ぶ。
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TableCard, TableSelectPage } from '@f-tool/ui';

import { TablesApi } from '../../core/api/tables-api';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-select-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [TableSelectPage],
  templateUrl: './table-select-container.html',
})
export class TableSelectContainer {
  protected readonly router = inject(Router);
  private api = inject(TablesApi);

  protected readonly loading = signal(true);
  protected readonly cards = signal<TableCard[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const tables = await this.api.listTables();
      this.cards.set(
        tables.map((t) => ({
          id: t.id,
          displayName: t.displayName,
          schemaName: t.schemaName,
          tableName: t.tableName,
          description: t.description,
          connectionName: t.connectionName ?? undefined,
        })),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected open(id: number): void {
    this.router.navigate(['/table-maint', id]);
  }
}
