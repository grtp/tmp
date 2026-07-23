// features/history — 操作履歴ビューア(admin)。
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  CsvExportChoice,
  CsvExportDialog,
  CsvExportDialogData,
  HistoryFilterChange,
  HistoryPage,
  HistoryRow,
} from '@f-tool/ui';

import { AdminApi } from '../../core/api/admin-api';
import { buildCsv, downloadCsv } from '../../core/csv';
import { openModal } from '../../core/dialog';
import { HistoryEntry } from '../../core/models';
import { formatJst } from '../../core/time';

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
  private dialogSvc = inject(MatDialog);

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
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
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

  /**
   * [CSV出力]押下: テーブルメンテと同じ3スコープのダイアログを開く
   * (選択範囲/表示範囲はクライアント生成，全件はサーバー生成)。
   */
  protected openCsvExport(selected: HistoryRow[]): void {
    const ref = openModal(
      this.dialogSvc,
      CsvExportDialog,
      {
        selectionCount: selected.length,
        pageCount: this.rows().length,
      } satisfies CsvExportDialogData,
      { width: '27.5rem', maxWidth: '95vw' },
    );
    ref.componentInstance.exported.subscribe((choice) => {
      void this.onCsvExport(ref, choice, selected);
    });
  }

  protected async onCsvExport(
    ref: MatDialogRef<CsvExportDialog>,
    choice: CsvExportChoice,
    selected: HistoryRow[],
  ): Promise<void> {
    ref.componentRef?.setInput('busy', true);
    try {
      let text: string;
      if (choice.scope === 'all') {
        // 全件はサーバー側でストリーム生成(現在のフィルタ条件を適用)。
        const f = this.filter;
        text = await this.admin.exportHistoryCsv({
          username: f.username || undefined,
          actionCode: f.actionCode || undefined,
          operation: f.operation || undefined,
          target: f.target || undefined,
          clientIp: f.clientIp || undefined,
          result: f.result || undefined,
          from: f.dateFrom ? `${f.dateFrom}T00:00:00+09:00` : undefined,
          to: f.dateTo ? `${f.dateTo}T23:59:59.999+09:00` : undefined,
        });
      } else {
        const source = choice.scope === 'selection' ? selected : this.rows();
        text = historyRowsToCsv(source);
      }
      downloadCsv('operation_history.csv', text, choice.excelCompat);
      ref.close();
    } finally {
      ref.componentRef?.setInput('busy', false);
    }
  }
}

/**
 * 表示中の行列を CSV へ(選択範囲/表示範囲出力用)。列はサーバー生成の
 * 全件出力と同順。summary は detail からのサーバー側導出値のため
 * クライアント生成では含めない(全件出力のみに付く)。
 */
function historyRowsToCsv(rows: HistoryRow[]): string {
  return buildCsv(
    [
      'occurred_at_jst', 'username', 'action_code', 'operation',
      'target', 'result', 'error_code', 'client_ip', 'detail',
    ],
    rows.map((r) => [
      r.occurredAt, r.username, r.actionCode, r.operation,
      r.target ?? '', r.result, r.errorCode ?? '', r.clientIp ?? '',
      compactDetail(r.detailText),
    ]),
  );
}

/**
 * detailText は画面の <pre> 表示用に整形済み(JSON.stringify(…, null, 2))
 * で改行を含む。CSV では 1 セル内の改行はダブルクォートで囲めば仕様上
 * 有効(RFC4180)だが，サーバー生成の全件出力(json.Marshal によるコンパクト
 * 1行 JSON)と体裁が食い違い，かつテキストエディタで開くと行が増えたように
 * 見えて混乱するため，コンパクトな 1 行 JSON に詰め直して揃える。
 */
function compactDetail(detailText: string): string {
  if (!detailText) return '';
  try {
    return JSON.stringify(JSON.parse(detailText));
  } catch {
    return detailText; // 万一パースできない場合は生文字列のまま
  }
}

function toRow(e: HistoryEntry): HistoryRow {
  const detail = e.detail as
    | { truncated?: boolean; overflowKey?: string }
    | undefined;
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
