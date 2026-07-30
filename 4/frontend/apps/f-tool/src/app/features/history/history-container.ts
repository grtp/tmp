// features/history — 操作履歴ビューア(共有グリッド tm-data-table-page ベース)。
// 履歴固有の表現(結果バッジ・行展開の detail)はセル/展開テンプレートで足す。
import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CellContext,
  ColumnDef,
  CsvExportChoice,
  CsvExportDialog,
  CsvExportDialogData,
  DataTablePage,
  FilterColumn,
  FilterPredicate,
  TableRow,
} from '@f-tool/ui';

import { AdminApi } from '../../core/api/admin-api';
import { buildCsv, downloadCsv } from '../../core/csv';
import { openModal } from '../../core/dialog';
import { HistoryEntry } from '../../core/models';
import { formatJst } from '../../core/time';

const PAGE_SIZE = 50;
/** 表示行に埋め込む元データ参照キー(列に無いので描画されない)。 */
const ROW_INDEX_KEY = '$i';

/** 画面表示用に整形済みの履歴1行。 */
interface HistoryRow {
  id: number;
  occurredAt: string;
  username: string;
  actionCode: string;
  operation: string;
  target: string;
  detailText: string;
  hasOverflow: boolean;
  result: string;
  errorCode?: string;
  clientIp?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-history-container',
  imports: [DataTablePage, MatButtonModule, MatIcon, TranslocoPipe],
  templateUrl: './history-container.html',
  styleUrl: './history-container.css',
})
export class HistoryContainer {
  private admin = inject(AdminApi);
  private dialogSvc = inject(MatDialog);
  private transloco = inject(TranslocoService);

  protected readonly pageSize = signal(PAGE_SIZE);

  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly predicates = signal<FilterPredicate[]>([]);
  /** 展開中の行 index(-1 = なし)。リロードで閉じる */
  protected readonly expandedIndex = signal(-1);

  /** 言語切替でヘッダー/フィルタ列ラベルを再計算するためのシグナル。 */
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  private t(key: string): string {
    // lang() を読むことで言語切替時に computed が再評価される
    void this.lang();
    return this.transloco.translate(key);
  }

  /** 結果バッジのセルテンプレート(html 側で宣言)。 */
  private readonly resultTpl = viewChild<TemplateRef<CellContext>>('resultTpl');

  protected readonly columnDefs = computed<ColumnDef[]>(() => [
    { key: 'occurredAt', label: this.t('history.thAt'), mono: true },
    { key: 'username', label: this.t('history.thUser') },
    { key: 'actionCode', label: this.t('history.thAction'), mono: true },
    { key: 'operation', label: this.t('history.thOperation'), mono: true },
    { key: 'target', label: this.t('history.thTarget'), mono: true },
    { key: 'result', label: this.t('history.thResult'), template: this.resultTpl() },
    { key: 'clientIp', label: this.t('history.thIp'), mono: true },
  ]);

  protected readonly filterColumns = computed<FilterColumn[]>(() => [
    { key: 'occurredAt', label: this.t('history.thAt'), type: 'datetime' },
    { key: 'username', label: this.t('history.thUser'), type: 'string' },
    { key: 'actionCode', label: this.t('history.thAction'), type: 'string' },
    { key: 'operation', label: this.t('history.thOperation'), type: 'string' },
    { key: 'target', label: this.t('history.thTarget'), type: 'string' },
    {
      key: 'result',
      label: this.t('history.thResult'),
      type: 'enum',
      // 表示は OK/NG(en は OK/Failed)。値は API の生値のまま
      enumValues: [
        { value: 'success', label: this.t('history.resultOk') },
        { value: 'failure', label: this.t('history.resultNg') },
      ],
    },
    { key: 'clientIp', label: this.t('history.thIp'), type: 'string' },
  ]);

  protected readonly displayRows = computed<TableRow[]>(() =>
    this.rows().map((r, i) => ({
      [ROW_INDEX_KEY]: i,
      occurredAt: r.occurredAt,
      username: r.username,
      actionCode: r.actionCode,
      operation: r.operation,
      target: r.target,
      result: r.result,
      clientIp: r.clientIp ?? '',
    })),
  );

  constructor() {
    void this.reload();
  }

  /** 表示行($i 付き)から元の HistoryRow を解決する。 */
  protected rowOf(display: TableRow): HistoryRow | undefined {
    const i = display[ROW_INDEX_KEY];
    return typeof i === 'number' ? this.rows()[i] : undefined;
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    this.expandedIndex.set(-1);
    try {
      const size = this.pageSize();
      const page = await this.admin.listHistory({
        limit: size,
        offset: (this.page() - 1) * size,
        preds: this.predicates(),
      });
      this.rows.set(page.entries.map(toRow));
      this.total.set(page.total);
    } finally {
      this.loading.set(false);
    }
  }

  protected onPredicatesChanged(preds: FilterPredicate[]): void {
    this.predicates.set(preds);
    this.page.set(1);
    void this.reload();
  }

  /** 行クリック = detail の展開/折りたたみ(detail が無い行は何もしない)。 */
  protected onRowSelected(display: TableRow): void {
    const row = this.rowOf(display);
    const i = display[ROW_INDEX_KEY];
    if (!row || typeof i !== 'number' || row.detailText === '') return;
    this.expandedIndex.set(this.expandedIndex() === i ? -1 : i);
  }

  /**
   * [JSONをダウンロード]押下 → どの行だったか分かるよう
   * { meta: 行の属性, detail: 従来の中身 } の2階層で落とす。
   * meta のキーは後処理(jq 等)のしやすさと言語切替の影響を避けるため
   * 英語固定。日時は画面と同じ JST 文字列。
   * 1MB超で MinIO へ退避された行(hasOverflow)はサーバー経由で全文を取得する。
   */
  protected async onDownloadRequested(display: TableRow): Promise<void> {
    const row = this.rowOf(display);
    if (!row) return;
    let detail: unknown;
    if (row.hasOverflow) {
      detail = await this.admin.getHistoryOverflow(row.id);
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
    a.download = `history-${row.id}-detail.json`;
    a.click();
    URL.revokeObjectURL(url);
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
   * (選択範囲/表示範囲はクライアント生成,全件はサーバー生成)。
   */
  protected openCsvExport(selectedDisplay: TableRow[]): void {
    const selected = selectedDisplay
      .map((d) => this.rowOf(d))
      .filter((r): r is HistoryRow => !!r);
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
        // 全件はサーバー側でストリーム生成(現在の述語を適用)。
        text = await this.admin.exportHistoryCsv(this.predicates());
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
 * 有効(RFC4180)だが,サーバー生成の全件出力(json.Marshal によるコンパクト
 * 1行 JSON)と体裁が食い違い,かつテキストエディタで開くと行が増えたように
 * 見えて混乱するため,コンパクトな 1 行 JSON に詰め直して揃える。
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
    target: e.target ?? '',
    detailText: e.detail ? JSON.stringify(e.detail, null, 2) : '',
    hasOverflow: !!detail?.truncated && !!detail?.overflowKey,
    result: e.result,
    errorCode: e.errorCode,
    clientIp: e.clientIp,
  };
}
