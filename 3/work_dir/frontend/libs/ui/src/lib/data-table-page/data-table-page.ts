import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

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

/**
 * テーブル表示画面 (A案: クラシック業務系)
 *
 * メタデータ駆動: columns 定義に基づいてヘッダー・セルを動的レンダリング。
 * table-maint の metadata-driven dynamic table rendering と同じ発想で、
 * 表示対象テーブルが増えても columns / rows の差し替えだけで対応できる。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-data-table-page',
  template: `
    <div class="panel">
      <div class="toolbar">
        <select
          class="table-select"
          [value]="selectedTable()"
          (change)="tableChanged.emit($any($event.target).value)"
        >
          @for (name of tableNames(); track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
        <input
          class="search"
          type="search"
          placeholder="キーワード検索"
          [value]="keyword()"
          (input)="onSearchInput($any($event.target).value)"
        />
        <button class="create" type="button" (click)="createClicked.emit()">
          <i class="ti ti-plus" aria-hidden="true"></i> 新規
        </button>
      </div>

      <table class="table">
        <thead>
          <tr>
            @for (col of columns(); track col.key) {
              <th [style.width]="col.width ?? null">{{ col.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @if (loading()) {
            <tr>
              <td class="state-cell" [attr.colspan]="columns().length">
                読み込み中…
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
                  該当するデータがありません
                </td>
              </tr>
            }
          }
        </tbody>
      </table>

      <div class="footer">
        <span>{{ rangeLabel() }}</span>
        <span class="pager">
          <button
            class="pager-btn"
            type="button"
            [disabled]="page() <= 1"
            (click)="pageChanged.emit(page() - 1)"
            aria-label="前のページ"
          >‹</button>
          {{ page() }} / {{ totalPages() }}
          <button
            class="pager-btn"
            type="button"
            [disabled]="page() >= totalPages()"
            (click)="pageChanged.emit(page() + 1)"
            aria-label="次のページ"
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
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: fixed;
    }
    th {
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
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
  /** 切り替え可能なテーブル名一覧 */
  readonly tableNames = input<string[]>(['品目マスタ']);
  readonly selectedTable = input('品目マスタ');
  /** 列メタデータ (これに基づいて動的レンダリング) */
  readonly columns = input<ColumnDef[]>([]);
  readonly rows = input<TableRow[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);

  readonly searchChanged = output<string>();
  readonly tableChanged = output<string>();
  readonly createClicked = output<void>();
  readonly rowSelected = output<TableRow>();
  readonly pageChanged = output<number>();

  protected readonly keyword = signal('');

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );

  protected readonly rangeLabel = computed(() => {
    const total = this.totalCount();
    if (total === 0) {
      return '0件';
    }
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return `${start}–${end} / ${total}件`;
  });

  protected onSearchInput(value: string): void {
    this.keyword.set(value);
    this.searchChanged.emit(value);
  }
}
