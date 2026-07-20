// features/history — 操作履歴ビューア(admin)。
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HistoryFilterChange, HistoryPage, HistoryRow } from '@f-tool/ui';

import { AdminApi } from '../../core/api/admin-api';
import { downloadCsv } from '../../core/csv';
import { HistoryEntry } from '../../core/models';

const PAGE_SIZE = 50;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-history-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [HistoryPage],
  templateUrl: './history-container.html',
})
export class HistoryContainer {
  private admin = inject(AdminApi);

  protected readonly pageSize = signal(PAGE_SIZE);

  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);

  private filter: HistoryFilterChange = {
    username: '',
    actionCode: '',
    operation: '',
    target: '',
    clientIp: '',
    result: '',
    dateFrom: '',
    dateTo: '',
  };

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const f = this.filter;
      const size = this.pageSize();
      const page = await this.admin.listHistory({
        limit: size,
        offset: (this.page() - 1) * size,
        username: f.username || undefined,
        actionCode: f.actionCode || undefined,
        operation: f.operation || undefined,
        target: f.target || undefined,
        clientIp: f.clientIp || undefined,
        result: f.result || undefined,
        // 日付は JST(+09:00) の 1 日境界で範囲化する(表示も JST)。
        from: f.dateFrom ? `${f.dateFrom}T00:00:00+09:00` : undefined,
        to: f.dateTo ? `${f.dateTo}T23:59:59.999+09:00` : undefined,
      });
      this.rows.set(page.entries.map(toRow));
      this.total.set(page.total);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * [JSONをダウンロード]押下 → どの行だったか分かるよう
   * { meta: 行の属性, detail: 従来の中身 } の2階層で落とす。
   * meta のキーは後処理(jq 等)のしやすさと言語切替の影響を避けるため
   * 英語固定。日時は画面と同じ JST 文字列。
   * 1MB超で MinIO へ退避された行(hasOverflow)はサーバー経由で全文を取得する。
   */
  protected async onDownloadRequested(id: number): Promise<void> {
    const row = this.rows().find((r) => r.id === id);
    if (!row) return;
    let detail: unknown;
    if (row.hasOverflow) {
      detail = await this.admin.getHistoryOverflow(id);
    } else {
      try {
        detail = JSON.parse(row.detailText);
      } catch {
        detail = row.detailText; // 万一パースできない場合は生文字列のまま
      }
    }
    const payload = {
      meta: {
        id: row.id,
        occurredAt: row.occurredAt,
        timezone: 'JST',
        username: row.username,
        actionCode: row.actionCode,
        operation: row.operation,
        target: row.target,
        result: row.result,
        errorCode: row.errorCode ?? null,
        clientIp: row.clientIp ?? null,
      },
      detail,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history-${id}-detail.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** フィルタは適用操作(Enter/選択)時のみ届くため，即時反映する。 */
  protected onFilterChanged(f: HistoryFilterChange): void {
    this.filter = f;
    this.page.set(1);
    void this.reload();
  }

  protected async onPageChanged(p: number): Promise<void> {
    this.page.set(p);
    await this.reload();
  }

  protected async onPageSizeChanged(size: number): Promise<void> {
    this.pageSize.set(size);
    this.page.set(1);
    await this.reload();
  }

  /** 現在のフィルタ条件で全履歴を CSV 出力(サーバー生成，BOM なし)。 */
  protected async onCsvExport(): Promise<void> {
    const f = this.filter;
    const text = await this.admin.exportHistoryCsv({
      username: f.username || undefined,
      actionCode: f.actionCode || undefined,
      operation: f.operation || undefined,
      target: f.target || undefined,
      clientIp: f.clientIp || undefined,
      result: f.result || undefined,
      from: f.dateFrom ? `${f.dateFrom}T00:00:00+09:00` : undefined,
      to: f.dateTo ? `${f.dateTo}T23:59:59.999+09:00` : undefined,
    });
    downloadCsv('operation_history.csv', text, false);
  }
}

/** UTC の ISO 文字列 → JST(+09:00) の 'YYYY-MM-DD HH:mm:ss' 表記。 */
function formatJst(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 19).replace('T', ' ');
}

function toRow(e: HistoryEntry): HistoryRow {
  const detail = e.detail as { truncated?: boolean; overflowKey?: string } | undefined;
  return {
    id: e.id,
    occurredAt: formatJst(e.occurredAt),
    username: e.username,
    actionCode: e.actionCode,
    operation: e.operation,
    target: e.target,
    detailText: e.detail ? JSON.stringify(e.detail, null, 2) : '',
    hasOverflow: !!detail?.truncated && !!detail?.overflowKey,
    result: e.result,
    errorCode: e.errorCode,
    clientIp: e.clientIp,
  };
}
