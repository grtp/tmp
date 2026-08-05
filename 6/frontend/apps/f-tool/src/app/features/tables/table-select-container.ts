// features/tables — 入口: 編集対象テーブルをカードで選ぶ。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TableCard, TableSelectPage } from '@f-tool/ui';

import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';

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
  private auth = inject(AuthService);

  protected readonly loading = signal(true);
  protected readonly cards = signal<TableCard[]>([]);
  protected readonly canManage = computed(() => this.auth.allows('settings', 'admin'));
  /** id -> slug(カード選択時に /tables/<slug> へ遷移するための引き当て)。 */
  private slugsById = new Map<number, string>();

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const tables = await this.api.listTables();
      this.slugsById = new Map(tables.map((t) => [t.id, t.slug]));
      this.cards.set(
        tables.map((t) => ({
          id: t.id,
          displayName: t.displayName,
          schemaName: t.schemaName,
          tableName: t.tableName,
          description: t.description,
          connectionName: t.connectionName ?? undefined,
          createdAt: t.createdAt,
          lastActivityAt: t.lastActivityAt ?? undefined,
        })),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected open(id: number): void {
    // URL は管理名(slug)のみ有効(/tables/products)。slug は必須項目のため
    // 引き当ては常に成功する(万一欠けていれば一覧へ戻るだけで壊れない)。
    this.router.navigate(['/tables', this.slugsById.get(id) ?? '']);
  }

  protected openManage(): void {
    this.router.navigate(['/settings/tables']);
  }
}
