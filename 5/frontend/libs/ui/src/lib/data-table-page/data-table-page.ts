import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { TmResizeColumnsDirective } from '../resize-columns/resize-columns.directive';

export interface ColumnDef {
  /** row オブジェクトのキー */
  key: string;
  label: string;
  /** 例: '90px'。省略時は可変幅 */
  width?: string;
  /** true で等幅フォント表示 (コード列向け) */
  mono?: boolean;
  /** フィルタ入力の種類。none = フィルタ不可(対応外型など)。既定 text */
  filter?: 'text' | 'bool' | 'none';
}

export type TableRow = Record<string, string | number>;

/**
 * テーブル表示画面 (A案: クラシック業務系)
 *
 * メタデータ駆動: columns 定義に基づいてヘッダー・セルを動的レンダリング。
 * - 列幅は TmResizeColumnsDirective でドラッグ調整(storageKey で永続化)
 * - 全体検索は Enter で実行(大テーブルでの打鍵ごと全走査を避ける)
 * - ヘッダー下のフィルタ行で列ごとの絞り込み(Enter で適用)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-data-table-page',
  imports: [TranslocoPipe, TmResizeColumnsDirective],
  templateUrl: './data-table-page.html',
  styleUrl: './data-table-page.css',
})
export class DataTablePage {
  /** 切り替え可能なテーブル名一覧(1件以下ならセレクタ非表示) */
  readonly tableNames = input<string[]>([]);
  readonly selectedTable = input('');
  /** 列メタデータ (これに基づいて動的レンダリング) */
  readonly columns = input<ColumnDef[]>([]);
  readonly rows = input<TableRow[]>([]);
  /**
   * DB 未反映の仮置き行(CSV 取込の[適応]後)。既存行より前(先頭)に表示し、
   * 最左に * マークを付ける。行クリック(編集)は無効。
   */
  readonly pendingRows = input<TableRow[]>([]);
  readonly totalCount = input(0);
  /** true なら総件数は上限値(10,000+ 表示) */
  readonly totalIsCapped = input(false);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);
  /** false なら[新規]ボタンを出さない(閲覧のみユーザー) */
  readonly canCreate = input(true);
  /**
   * 除外(hidden)された必須列。1つでもあると INSERT が必ず失敗するため、
   * [新規]と[CSV取込]をグレーアウトし、ホバーで理由を表示する。
   */
  readonly insertBlockedColumns = input<string[]>([]);
  /** 列幅永続化キー(例 "forge.colw:1:dbo.products")。空なら永続化しない */
  readonly storageKey = input('');

  /** 列フィルタの確定(Enter/選択時)。空値は含まれない */
  readonly filtersChanged = output<Record<string, string>>();
  readonly tableChanged = output<string>();
  readonly createClicked = output<void>();
  readonly rowSelected = output<TableRow>();
  /** [まとめて削除]押下。チェック中の行を渡す((*)行含む。確認はコンテナの責務) */
  readonly bulkDeleteClicked = output<TableRow[]>();
  /** [まとめて保存]押下。チェック中の (*)行を渡す(保存はコンテナの責務) */
  readonly savePendingClicked = output<TableRow[]>();
  /** [CSV出力]押下。チェック中の行を渡す(スコープ選択と出力はコンテナの責務) */
  readonly csvExportClicked = output<TableRow[]>();
  /** [CSV取込]でファイルが選ばれた(精査とマージ画面はコンテナの責務) */
  readonly csvFileSelected = output<File>();
  readonly pageChanged = output<number>();
  /** 表示件数の変更(10/20/50/100) */
  readonly pageSizeChanged = output<number>();

  protected readonly PAGE_SIZES = [10, 20, 50, 100];
  /** 入力中(未確定)の列フィルタ値 */
  protected readonly filterValues = signal<Record<string, string>>({});
  /** チェック中の行((*)行 + DB 行の通し index)。行が入れ替わったらリセット */
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  /** 複数選択モード([複数選択]トグル中だけチェックボックスを出す) */
  protected readonly multiSelectMode = signal(false);

  constructor() {
    effect(() => {
      void this.rows();
      void this.pendingRows();
      this.selected.set(new Set());
    });
  }

  /** 表示行 = (*)行(先頭) + DB 行。選択 index はこの通し。 */
  protected readonly allRows = computed<TableRow[]>(() => [
    ...this.pendingRows(),
    ...this.rows(),
  ]);

  protected isPending(index: number): boolean {
    return index < this.pendingRows().length;
  }

  protected readonly selectedCount = computed(() => this.selected().size);

  /** チェック中の (*)行数([まとめて保存]の表示条件) */
  protected readonly selectedPendingCount = computed(() => {
    const n = this.pendingRows().length;
    let count = 0;
    for (const i of this.selected()) if (i < n) count++;
    return count;
  });

  protected readonly allChecked = computed(
    () => this.allRows().length > 0 && this.selected().size === this.allRows().length,
  );

  /** 状態行(loading/empty)の colspan(チェック列の有無で変わる) */
  protected readonly colspan = computed(
    () => this.columns().length + (this.multiSelectMode() ? 1 : 0),
  );

  protected toggleMultiSelect(): void {
    const next = !this.multiSelectMode();
    this.multiSelectMode.set(next);
    if (!next) this.selected.set(new Set()); // モード解除で選択も破棄
  }
  /** 確定済み(サーバーに送った)の列フィルタ。チップ表示の元 */
  protected readonly appliedFilters = signal<Record<string, string>>({});
  /** フィルタ行の開閉(ツールバーのじょうごで切替) */
  protected readonly filterRowVisible = signal(false);

  protected readonly activeFilterCount = computed(
    () => Object.keys(this.appliedFilters()).length,
  );

  /** 適用中フィルタのチップ(列ラベルは columns から解決) */
  protected readonly filterChips = computed(() => {
    const byKey = new Map(this.columns().map((c) => [c.key, c.label]));
    return Object.entries(this.appliedFilters()).map(([key, value]) => ({
      key,
      label: byKey.get(key) ?? key,
      value,
    }));
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );

  /** ページジャンプ用の 1..totalPages(select はキー入力でも移動できる)。 */
  protected readonly pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1),
  );

  protected readonly rangeParams = computed(() => {
    const total = this.totalCount();
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return { start, end, total };
  });

  protected toggleRow(index: number, checked: boolean): void {
    this.selected.update((cur) => {
      const next = new Set(cur);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  protected toggleAll(checked: boolean): void {
    this.selected.set(checked ? new Set(this.allRows().map((_, i) => i)) : new Set());
  }

  protected onBulkDelete(): void {
    const rows = this.allRows().filter((_, i) => this.selected().has(i));
    if (rows.length > 0) this.bulkDeleteClicked.emit(rows);
  }

  protected onSavePending(): void {
    // (*)行は通し index の先頭に並ぶため、pendingRows の添字 = 通し index。
    const rows = this.pendingRows().filter((_, i) => this.selected().has(i));
    if (rows.length > 0) this.savePendingClicked.emit(rows);
  }

  protected onCsvExport(): void {
    this.csvExportClicked.emit(this.allRows().filter((_, i) => this.selected().has(i)));
  }

  // ------------------------------------- ドラッグ範囲選択(複数選択モード)

  /** ドラッグ開始候補の行(null = 非ドラッグ)。別の行に入った時点で確定 */
  private dragAnchor: number | null = null;
  private dragActive = false;
  /** ドラッグ直後の click(編集ダイアログ)を 1 回だけ抑止する */
  private suppressClick = false;

  protected onRowPointerDown(index: number, e: PointerEvent): void {
    if (!this.multiSelectMode() || e.button !== 0) return;
    // チェックボックス列の上からでもドラッグ開始できる(そのまま離せば
    // checkbox の通常トグル、動かせば範囲選択)。
    this.dragAnchor = index;
    this.dragActive = false;
  }

  protected onRowPointerEnter(index: number): void {
    if (this.dragAnchor === null) return;
    if (!this.dragActive && index === this.dragAnchor) return;
    this.dragActive = true;
    const a = this.dragAnchor;
    const [from, to] = a <= index ? [a, index] : [index, a];
    const next = new Set<number>();
    for (let i = from; i <= to; i++) next.add(i);
    this.selected.set(next);
  }

  @HostListener('document:pointerup')
  protected onPointerUp(): void {
    if (this.dragActive) {
      // ドラッグ直後の click(pointerup と同一サイクルで届く)だけを抑止する。
      // down/up が別要素だと click が行に届かずフラグが残留するため、
      // 次のイベントループで必ずリセットする。
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    }
    this.dragAnchor = null;
    this.dragActive = false;
  }

  protected onRowClick(index: number, row: TableRow): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    // 複数選択モード中は行クリック = 選択のトグル(編集ダイアログは開かない)。
    if (this.multiSelectMode()) {
      this.toggleRow(index, !this.selected().has(index));
      return;
    }
    if (this.isPending(index)) return; // (*)行は編集不可
    this.rowSelected.emit(row);
  }

  protected onCsvFileSelected(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = ''; // 同じファイルの再選択でも change を発火させる
    if (file) this.csvFileSelected.emit(file);
  }

  protected filterOf(key: string): string {
    return this.filterValues()[key] || '';
  }

  protected setFilter(key: string, value: string): void {
    this.filterValues.update((m) => ({ ...m, [key]: value }));
  }

  protected onFilterInput(key: string, value: string): void {
    this.setFilter(key, value);
    // フィルタのクリアも即時反映(実行は Enter)。
    if (value === '') {
      this.applyFilters();
    }
  }

  protected applyFilters(): void {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.filterValues())) {
      if (v.trim() !== '') out[k] = v.trim();
    }
    this.appliedFilters.set(out);
    this.filtersChanged.emit(out);
  }

  /** チップの × で該当列のフィルタだけ外す(即時反映)。 */
  protected removeFilter(key: string): void {
    this.setFilter(key, '');
    this.applyFilters();
  }

  protected clearAllFilters(): void {
    this.filterValues.set({});
    this.applyFilters();
  }
}
