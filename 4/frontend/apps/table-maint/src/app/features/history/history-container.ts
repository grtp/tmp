// features/history — 操作履歴ビューア(admin)。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { HistoryFilterChange, HistoryPage, HistoryRow, PageHeader } from '@table-maint/ui';

import { AdminApi } from '../../core/api/admin-api';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryEntry } from '../../core/models';

const PAGE_SIZE = 50;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-history-container',
  imports: [HistoryPage, PageHeader, TranslocoPipe],
  template: `
    <tm-page-header
      [pageTitle]="'pages.history' | transloco"
      [userName]="userName()"
      (backClicked)="router.navigate(['/dashboard'])"
      (logoutClicked)="logout()"
    />

    <tm-history-page
      [entries]="rows()"
      [totalCount]="total()"
      [page]="page()"
      [pageSize]="pageSize"
      [loading]="loading()"
      (filterChanged)="onFilterChanged($event)"
      (pageChanged)="onPageChanged($event)"
    />
  `,
})
export class HistoryContainer {
  protected readonly router = inject(Router);
  private auth = inject(AuthService);
  private admin = inject(AdminApi);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);

  private filter: HistoryFilterChange = { username: '', actionCode: '', result: '' };
  private filterTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.admin.listHistory({
        limit: PAGE_SIZE,
        offset: (this.page() - 1) * PAGE_SIZE,
        username: this.filter.username || undefined,
        actionCode: this.filter.actionCode || undefined,
        result: this.filter.result || undefined,
      });
      this.rows.set(page.entries.map(toRow));
      this.total.set(page.total);
    } finally {
      this.loading.set(false);
    }
  }

  protected onFilterChanged(f: HistoryFilterChange): void {
    this.filter = f;
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.page.set(1);
      void this.reload();
    }, 300);
  }

  protected async onPageChanged(p: number): Promise<void> {
    this.page.set(p);
    await this.reload();
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

function toRow(e: HistoryEntry): HistoryRow {
  return {
    id: e.id,
    occurredAt: e.occurredAt,
    username: e.username,
    actionCode: e.actionCode,
    operation: e.operation,
    target: e.target,
    detailText: e.detail ? JSON.stringify(e.detail, null, 2) : '',
    result: e.result,
    errorCode: e.errorCode,
    clientIp: e.clientIp,
  };
}
