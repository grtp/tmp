import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';

export interface HistoryRow {
  id: number;
  occurredAt: string;
  username: string;
  actionCode: string;
  operation: string;
  target?: string;
  /** 整形済み JSON テキスト('' = なし) */
  detailText: string;
  /** detail が1MB超でMinIOへ退避されている(「全文をダウンロード」ボタンを出す) */
  hasOverflow: boolean;
  result: 'success' | 'failure';
  errorCode?: string;
  clientIp?: string;
}

/** フィルタのキー。テキスト系は部分一致、日付は UTC 日付(範囲)。 */
export type HistoryFilterKey =
  | 'username'
  | 'actionCode'
  | 'operation'
  | 'target'
  | 'clientIp'
  | 'result'
  | 'dateFrom'
  | 'dateTo';

export interface HistoryFilterChange {
  username: string;
  actionCode: string;
  operation: string;
  target: string;
  clientIp: string;
  result: '' | 'success' | 'failure';
  /** UTC 日付 YYYY-MM-DD('' = 指定なし) */
  dateFrom: string;
  dateTo: string;
}

const TEXT_KEYS: HistoryFilterKey[] = ['username', 'operation', 'target', 'clientIp'];

/**
 * 操作履歴ビューア(admin)。
 * フィルタはデータテーブルと同じ形式: ツールバーのじょうごで
 * ヘッダー下のフィルタ行を開閉し、適用中の条件はチップで表示する。
 * テキスト列 = 部分一致(Enter 適用) / kind 列(機能・結果) = select /
 * 日時 = 開始・終了日(UTC)の範囲。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-history-page',
  imports: [TranslocoPipe, TmResizeColumnsDirective],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
})
export class HistoryPage {
  readonly entries = input<HistoryRow[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);
  /** 機能フィルタの選択肢(組込機能のコード) */
  readonly actionCodes = input<string[]>(['auth', 'table-maint', 'settings', 'history', 'dashboard']);

  readonly filterChanged = output<HistoryFilterChange>();
  readonly pageChanged = output<number>();
  /** 表示件数の変更(10/20/50/100) */
  readonly pageSizeChanged = output<number>();
  /** [CSV出力]押下(現在のフィルタ条件で全件出力。実処理はコンテナ) */
  readonly csvExportClicked = output<void>();
  /** [全文をダウンロード]押下(コンテナが取得してファイルダウンロードする) */
  readonly overflowRequested = output<number>();

  protected readonly PAGE_SIZES = [10, 20, 50, 100];

  /** 適用済みフィルタ(チップ表示の元) */
  protected readonly applied = signal<Record<string, string>>({});
  /** テキスト系の入力中(未確定)値 */
  protected readonly drafts = signal<Record<string, string>>({});

  protected readonly filterRowVisible = signal(false);
  protected readonly expanded = signal<number | null>(null);

  protected readonly activeFilterCount = computed(
    () => Object.values(this.applied()).filter((v) => v !== '').length,
  );

  /** 適用中フィルタのチップ(列名の i18n キー付き)。 */
  protected readonly chips = computed(() => {
    const a = this.applied();
    const defs: [HistoryFilterKey, string][] = [
      ['username', 'history.thUser'],
      ['actionCode', 'history.thAction'],
      ['operation', 'history.thOperation'],
      ['target', 'history.thTarget'],
      ['clientIp', 'history.thIp'],
      ['result', 'history.thResult'],
      ['dateFrom', 'history.chipFrom'],
      ['dateTo', 'history.chipTo'],
    ];
    return defs
      .filter(([key]) => (a[key] ?? '') !== '')
      .map(([key, labelKey]) => ({ key, labelKey, value: a[key] }));
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );

  /** ページジャンプ用の 1..totalPages。 */
  protected readonly pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1),
  );

  protected readonly rangeParams = computed(() => {
    const total = this.totalCount();
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return { start, end, total };
  });

  protected draftOf(key: HistoryFilterKey): string {
    return this.drafts()[key] ?? '';
  }

  protected appliedOf(key: HistoryFilterKey): string {
    return this.applied()[key] ?? '';
  }

  /** テキスト系: 入力中はドラフト、空にしたら即解除(実行は Enter)。 */
  protected onTextInput(key: HistoryFilterKey, value: string): void {
    this.drafts.update((m) => ({ ...m, [key]: value }));
    if (value === '' && this.appliedOf(key) !== '') {
      this.setApplied(key, '');
    }
  }

  protected applyText(key: HistoryFilterKey): void {
    this.setApplied(key, this.draftOf(key).trim());
  }

  /** select / date は変更で即適用。 */
  protected setApplied(key: HistoryFilterKey, value: string): void {
    this.applied.update((m) => ({ ...m, [key]: value }));
    this.emitFilter();
  }

  protected clearFilter(key: HistoryFilterKey): void {
    if (TEXT_KEYS.includes(key)) {
      this.drafts.update((m) => ({ ...m, [key]: '' }));
    }
    this.setApplied(key, '');
  }

  protected clearAllFilters(): void {
    this.drafts.set({});
    this.applied.set({});
    this.emitFilter();
  }

  private emitFilter(): void {
    const a = this.applied();
    const result = a['result'];
    this.filterChanged.emit({
      username: a['username'] ?? '',
      actionCode: a['actionCode'] ?? '',
      operation: a['operation'] ?? '',
      target: a['target'] ?? '',
      clientIp: a['clientIp'] ?? '',
      result: result === 'success' || result === 'failure' ? result : '',
      dateFrom: a['dateFrom'] ?? '',
      dateTo: a['dateTo'] ?? '',
    });
  }

  protected toggle(id: number): void {
    this.expanded.update((cur) => (cur === id ? null : id));
  }
}
