import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export interface ColumnDef {
  /** row オブジェクトのキー */
  key: string;
  label: string;
  /** 例: '90px'。省略時は可変幅 */
  width?: string;
  /** true で等幅フォント表示 (コード列向け) */
  mono?: boolean;
}

export type TableRow = Record<string, string | number>;

const MIN_COL_WIDTH = 60;

/**
 * テーブル表示画面 (A案: クラシック業務系)
 *
 * メタデータ駆動: columns 定義に基づいてヘッダー・セルを動的レンダリング。
 * - 列ヘッダーの境界をドラッグして幅を調整できる(ダブルクリックでリセット)。
 *   storageKey を渡すと localStorage にテーブル単位で永続化する。
 * - tableNames が 1 件以下ならセレクタを出さずラベル表示にする
 *   (カード選択 UI への移行後はプルダウンを使わない)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-data-table-page',
  imports: [TranslocoPipe],
  template: `
    <div class="panel">
      <div class="toolbar">
        @if (tableNames().length > 1) {
          <select
            class="table-select"
            [value]="selectedTable()"
            (change)="tableChanged.emit($any($event.target).value)"
          >
            @for (name of tableNames(); track name) {
              <option [value]="name">{{ name }}</option>
            }
          </select>
        } @else {
          <span class="table-label">{{ selectedTable() }}</span>
        }
        <input
          class="search"
          type="search"
          [placeholder]="'dataTable.searchPlaceholder' | transloco"
          [value]="keyword()"
          (input)="onSearchInput($any($event.target).value)"
        />
        @if (canCreate()) {
          <button class="create" type="button" (click)="createClicked.emit()">
            <i class="ti ti-plus" aria-hidden="true"></i> {{ 'dataTable.create' | transloco }}
          </button>
        }
      </div>

      <div class="table-wrap">
        <table class="table" [class.resizing]="resizing() !== null">
          <colgroup>
            @for (col of columns(); track col.key) {
              <col [style.width]="widthOf(col)" />
            }
          </colgroup>
          <thead>
            <tr>
              @for (col of columns(); track col.key) {
                <th>
                  <span class="th-label">{{ col.label }}</span>
                  <span
                    class="resize-handle"
                    (pointerdown)="startResize($event, col.key)"
                    (dblclick)="resetWidth(col.key)"
                    aria-hidden="true"
                  ></span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              <tr>
                <td class="state-cell" [attr.colspan]="columns().length">
                  {{ 'common.loading' | transloco }}
                </td>
              </tr>
            } @else {
              @for (row of rows(); track $index; let odd = $odd) {
                <tr [class.odd]="odd" (click)="rowSelected.emit(row)">
                  @for (col of columns(); track col.key) {
                    <td [class.mono]="col.mono">{{ row[col.key] }}</td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td class="state-cell" [attr.colspan]="columns().length">
                    {{ 'dataTable.empty' | transloco }}
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <div class="footer">
        @if (totalCount() === 0) {
          <span>{{ 'common.rangeEmpty' | transloco }}</span>
        } @else {
          <span>{{ 'common.range' | transloco: rangeParams() }}</span>
        }
        <span class="pager">
          <button
            class="pager-btn"
            type="button"
            [disabled]="page() <= 1"
            (click)="pageChanged.emit(page() - 1)"
            [attr.aria-label]="'common.prevPage' | transloco"
          >‹</button>
          {{ page() }} / {{ totalPages() }}
          <button
            class="pager-btn"
            type="button"
            [disabled]="page() >= totalPages()"
            (click)="pageChanged.emit(page() + 1)"
            [attr.aria-label]="'common.nextPage' | transloco"
          >›</button>
        </span>
      </div>
    </div>
  `,
  styles: `
    .panel {
      background: var(--tm-surface);
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      overflow: hidden;
      margin: 16px;
    }
    .toolbar {
      padding: 10px 12px;
      border-bottom: 1px solid var(--tm-border);
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .table-select,
    .search {
      height: 34px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      background: var(--tm-surface);
      color: var(--tm-text);
    }
    .table-select {
      width: 160px;
    }
    .table-label {
      font-size: 13px;
      font-weight: 600;
      padding: 0 4px;
      white-space: nowrap;
    }
    .search {
      flex: 1;
    }
    .search:focus,
    .table-select:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .create {
      height: 34px;
      padding: 0 14px;
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      border: none;
      border-radius: var(--tm-radius);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .create:hover {
      background: var(--tm-primary-dark);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: fixed;
    }
    .table.resizing {
      user-select: none;
      cursor: col-resize;
    }
    th {
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
      position: relative;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .resize-handle {
      position: absolute;
      top: 0;
      right: -4px;
      width: 9px;
      height: 100%;
      cursor: col-resize;
      z-index: 1;
    }
    .resize-handle:hover {
      background: rgba(255, 255, 255, 0.25);
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--tm-border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tbody tr {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--tm-primary-tint-weak);
    }
    tbody tr.odd {
      background: var(--tm-surface-alt);
    }
    tbody tr.odd:hover {
      background: var(--tm-primary-tint-weak);
    }
    .mono {
      font-family: var(--tm-font-mono);
    }
    .state-cell {
      text-align: center;
      color: var(--tm-text-muted);
      padding: 28px 10px;
      cursor: default;
    }
    .footer {
      padding: 8px 12px;
      font-size: 11px;
      color: var(--tm-text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .pager {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pager-btn {
      border: 1px solid var(--tm-border);
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: 24px;
      height: 24px;
      cursor: pointer;
      color: var(--tm-text-secondary);
      font-family: inherit;
    }
    .pager-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `,
})
export class DataTablePage {
  /** 切り替え可能なテーブル名一覧(1件以下ならセレクタ非表示) */
  readonly tableNames = input<string[]>([]);
  readonly selectedTable = input('');
  /** 列メタデータ (これに基づいて動的レンダリング) */
  readonly columns = input<ColumnDef[]>([]);
  readonly rows = input<TableRow[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);
  /** false なら[新規]ボタンを出さない(閲覧のみユーザー) */
  readonly canCreate = input(true);
  /** 列幅永続化キー(例 "colw:1:dbo.products")。空なら永続化しない */
  readonly storageKey = input('');

  readonly searchChanged = output<string>();
  readonly tableChanged = output<string>();
  readonly createClicked = output<void>();
  readonly rowSelected = output<TableRow>();
  readonly pageChanged = output<number>();

  protected readonly keyword = signal('');
  /** 列 key -> px 幅(ユーザー調整分のみ) */
  protected readonly widths = signal<Record<string, number>>({});
  /** リサイズ中の列 key(null = していない) */
  protected readonly resizing = signal<string | null>(null);

  constructor() {
    // storageKey が変わるたびに保存済みの列幅を読み直す。
    effect(() => {
      const key = this.storageKey();
      this.widths.set(key ? loadWidths(key) : {});
    });
  }

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );

  protected readonly rangeParams = computed(() => {
    const total = this.totalCount();
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return { start, end, total };
  });

  protected widthOf(col: ColumnDef): string | null {
    const w = this.widths()[col.key];
    if (w) return `${w}px`;
    return col.width ?? null;
  }

  protected onSearchInput(value: string): void {
    this.keyword.set(value);
    this.searchChanged.emit(value);
  }

  // ------------------------------------------------------- column resize

  protected startResize(e: PointerEvent, key: string): void {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    this.resizing.set(key);

    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX));
      this.widths.update((m) => ({ ...m, [key]: w }));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.resizing.set(null);
      this.persist();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  protected resetWidth(key: string): void {
    this.widths.update((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    this.persist();
  }

  private persist(): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      const widths = this.widths();
      if (Object.keys(widths).length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(widths));
      }
    } catch {
      // 永続化できない環境では黙ってスキップ(機能自体は動く)
    }
  }
}

function loadWidths(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v >= MIN_COL_WIDTH) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
