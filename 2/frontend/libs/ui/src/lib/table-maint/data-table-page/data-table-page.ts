import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  TemplateRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';

import { FilterBar } from '../../shared/filter-bar/filter-bar';
import {
  FilterColumn,
  FilterPredicate,
} from '../../shared/filter-bar/filter-model';
import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';

export type TableRow = Record<string, string | number>;

/**
 * セル/展開テンプレートのコンテキスト($implicit = 表示行)。
 * col は描画中の列定義(1つのテンプレートを複数列で使い回す場合に
 * meta で列固有のデータを引くために渡す)。
 */
export interface CellContext {
  $implicit: TableRow;
  col: ColumnDef;
}

export interface ColumnDef {
  /** row オブジェクトのキー */
  key: string;
  label: string;
  /** 例: '90px'。省略時は可変幅 */
  width?: string;
  /** true で等幅フォント表示 (コード列向け) */
  mono?: boolean;
  /**
   * セルのカスタム描画(バッジ・プルダウン等)。省略時は row[key] を
   * そのまま表示する。テンプレートは利用側コンポーネントで宣言する
   * (スタイルも宣言側のスコープが効く)。
   */
  template?: TemplateRef<CellContext>;
  /** テンプレートへ渡す列固有データ(ユーザー権限列の actionId 等) */
  meta?: unknown;
}

/**
 * 共有グリッド (A案: クラシック業務系)
 *
 * メタデータ駆動: columns 定義に基づいてヘッダー・セルを動的レンダリング。
 * テーブルメンテだけでなく操作履歴・ユーザー一覧も同じ部品を使う前提で,
 * 操作系(新規/CSV取込/複数選択等)は入力フラグで出し分ける。
 * - 列幅は TmResizeColumnsDirective でドラッグ調整(storageKey で永続化)
 * - 絞り込みはチップフィルタ(tm-filter-bar)。述語の解釈はサーバー
 * - 高度な要件(グループ化・集計等)はここに足さず,その画面だけ
 *   AG Grid 等へ置き換える方針(フィルタと述語 API は共通のまま)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-data-table-page',
  imports: [FilterBar, MatButtonModule, MatIcon, NgTemplateOutlet, TranslocoPipe, TmResizeColumnsDirective],
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
   * DB 未反映の仮置き行(CSV 取込の[適応]後)。既存行より前(先頭)に表示し，
   * 最左に * マークを付ける。行クリック(編集)は無効。
   */
  readonly pendingRows = input<TableRow[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);
  /** false なら[新規]ボタンを出さない(閲覧のみユーザー) */
  readonly canCreate = input(true);
  /**
   * 除外(hidden)された必須列。1つでもあると INSERT が必ず失敗するため，
   * [新規]と[CSV取込]をグレーアウトし，ホバーで理由を表示する。
   */
  readonly insertBlockedColumns = input<string[]>([]);
  /** 列幅永続化キー(例 "ftool.colw:1:dbo.products")。空なら永続化しない */
  readonly storageKey = input('');
  /** チップフィルタの対象列(空ならフィルタバー自体を出さない) */
  readonly filterColumns = input<FilterColumn[]>([]);
  /** 適用中の述語(状態はコンテナが持つ) */
  readonly predicates = input<FilterPredicate[]>([]);
  /** [複数選択]トグルを出すか(canCreate と独立。履歴は選択CSV出力用に true) */
  readonly showMultiSelect = input(false);
  /** [CSV出力]を出すか(ユーザー一覧は false) */
  readonly showCsvExport = input(true);
  /** 展開中の行 index(-1 = なし)。expandTemplate とセットで使う */
  readonly expandedIndex = input(-1);
  /** 行直下に挿入する展開テンプレート(履歴の detail 表示等) */
  readonly expandTemplate = input<TemplateRef<{ $implicit: TableRow }> | null>(null);

  /** チップフィルタの変更(追加/編集/解除) */
  readonly predicatesChange = output<FilterPredicate[]>();
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
  /** 表示件数の変更(10/20/50/100/500/1000) */
  readonly pageSizeChanged = output<number>();

  protected readonly PAGE_SIZES = [10, 20, 50, 100, 500, 1000];

  private readonly filterBar = viewChild(FilterBar);
  /** フィルタバーのポップオーバーが開いている間 true(行の表示維持用) */
  protected readonly filterPopOpen = signal(false);

  /**
   * フィルタ行は「条件がある間」または「ポップオーバーを開いている間」だけ
   * 表示する(既定は非表示。じょうごから開始する)。
   */
  protected readonly filterRowVisible = computed(
    () =>
      this.filterColumns().length > 0 &&
      (this.predicates().length > 0 || this.filterPopOpen()),
  );

  /**
   * ツールバーのじょうご: 行が出ていなければ出した上で,
   * 直接列選択ポップオーバーを開く(空のバーを経由させない)。
   * ポップオーバーは押したじょうごの真下に表示する。
   */
  protected onFilterButton(e: Event): void {
    const anchor = e.currentTarget as HTMLElement;
    this.filterPopOpen.set(true);
    // @if で行が描画されるのを待ってから開く(viewChild は描画後に解決される)
    setTimeout(() => this.filterBar()?.openPicker(anchor));
  }

  protected onFilterOpenChanged(open: boolean): void {
    this.filterPopOpen.set(open);
  }

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
    () =>
      this.allRows().length > 0 &&
      this.selected().size === this.allRows().length,
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
    // 大きな総件数の可読性のため 3 桁区切りで整形する(カップ廃止で実数表示)
    return {
      start: start.toLocaleString('en-US'),
      end: end.toLocaleString('en-US'),
      total: total.toLocaleString('en-US'),
    };
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
    this.selected.set(
      checked ? new Set(this.allRows().map((_, i) => i)) : new Set(),
    );
  }

  protected onBulkDelete(): void {
    const rows = this.allRows().filter((_, i) => this.selected().has(i));
    if (rows.length > 0) this.bulkDeleteClicked.emit(rows);
  }

  protected onSavePending(): void {
    // (*)行は通し index の先頭に並ぶため，pendingRows の添字 = 通し index。
    const rows = this.pendingRows().filter((_, i) => this.selected().has(i));
    if (rows.length > 0) this.savePendingClicked.emit(rows);
  }

  protected onCsvExport(): void {
    this.csvExportClicked.emit(
      this.allRows().filter((_, i) => this.selected().has(i)),
    );
  }

  /** ドラッグ開始候補の行(null = 非ドラッグ)。別の行に入った時点で確定 */
  private dragAnchor: number | null = null;
  private dragActive = false;
  /** ドラッグ直後の click(編集ダイアログ)を 1 回だけ抑止する */
  private suppressClick = false;

  protected onRowPointerDown(index: number, e: PointerEvent): void {
    if (!this.multiSelectMode() || e.button !== 0) return;
    // チェックボックス列の上からでもドラッグ開始できる(そのまま離せば
    // checkbox の通常トグル，動かせば範囲選択)。
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
      // down/up が別要素だと click が行に届かずフラグが残留するため，
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

  /** CSV の drag&drop 受付中(ドロップ可能オーバーレイの表示制御)。 */
  protected readonly csvDragActive = signal(false);
  /** dragenter/leave は子要素の通過でも対で発火するため深さを数えて相殺する */
  private csvDragDepth = 0;

  /** ドロップで CSV 取込を受け付けられる状態か([CSV取込]ボタンの活性条件と同一)。 */
  private canDropCsv(): boolean {
    return this.canCreate() && this.insertBlockedColumns().length === 0;
  }

  private hasFiles(e: DragEvent): boolean {
    return !!e.dataTransfer && e.dataTransfer.types.includes('Files');
  }

  protected onDragEnter(e: DragEvent): void {
    if (!this.canDropCsv() || !this.hasFiles(e)) return;
    e.preventDefault();
    this.csvDragDepth++;
    this.csvDragActive.set(true);
  }

  protected onDragOver(e: DragEvent): void {
    if (!this.canDropCsv() || !this.hasFiles(e)) return;
    e.preventDefault(); // preventDefault しないと drop イベント自体が発火しない
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(): void {
    if (this.csvDragDepth === 0) return;
    this.csvDragDepth--;
    if (this.csvDragDepth === 0) this.csvDragActive.set(false);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.csvDragDepth = 0;
    this.csvDragActive.set(false);
    if (!this.canDropCsv()) return;
    // 複数ドロップは先頭のみ。CSV 以外はファイル選択の accept=".csv" と
    // 整合させるため黙って無視する(取込フローはボタン経由と完全に同じ)。
    const file = e.dataTransfer?.files?.[0];
    if (file && (/\.csv$/i.test(file.name) || file.type === 'text/csv')) {
      this.csvFileSelected.emit(file);
    }
  }

  /** パネル外への誤ドロップでブラウザがファイルを開いて画面遷移するのを防ぐ。 */
  @HostListener('document:dragover', ['$event'])
  @HostListener('document:drop', ['$event'])
  protected preventDocumentDrop(e: DragEvent): void {
    if (this.hasFiles(e)) e.preventDefault();
  }
}
