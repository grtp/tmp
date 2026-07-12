// features/table-maint — 入口: 編集対象テーブルをカードで選ぶ。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { PageHeader, TableCard, TableSelectPage } from '@table-maint/ui';

import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-select-container',
  imports: [TableSelectPage, PageHeader, TranslocoPipe],
  templateUrl: './table-select-container.html',
})
export class TableSelectContainer {
  protected readonly router = inject(Router);
  private auth = inject(AuthService);
  private api = inject(TablesApi);

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');
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

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
