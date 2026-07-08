import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

export interface HistoryRow {
  id: number;
  occurredAt: string;
  username: string;
  actionCode: string;
  operation: string;
  target?: string;
  /** 整形済み JSON テキスト('' = なし) */
  detailText: string;
  result: 'success' | 'failure';
  errorCode?: string;
  clientIp?: string;
}

export interface HistoryFilterChange {
  username: string;
  actionCode: string;
  result: '' | 'success' | 'failure';
}

/**
 * 操作履歴ビューア(admin)。フィルタ + ページング + 行展開で detail JSON を表示。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-history-page',
  template: `
    <div class="panel">
      <div class="toolbar">
        <input class="input" type="search" placeholder="ユーザー名"
          [value]="username()" (input)="username.set($any($event.target).value); emitFilter()" />
        <select class="select" [value]="actionCode()"
          (change)="actionCode.set($any($event.target).value); emitFilter()">
          <option value="">全機能</option>
          <option value="auth">auth (ログイン)</option>
          <option value="table-maint">table-maint</option>
          <option value="settings">settings</option>
        </select>
        <select class="select" [value]="result()"
          (change)="result.set($any($event.target).value); emitFilter()">
          <option value="">成否: 全て</option>
          <option value="success">success</option>
          <option value="failure">failure</option>
        </select>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th class="w150">日時 (UTC)</th><th class="w110">ユーザー</th>
            <th class="w110">機能</th><th class="w150">操作</th>
            <th>対象</th><th class="w80">結果</th><th class="w110">IP</th>
          </tr>
        </thead>
        <tbody>
          @if (loading()) {
            <tr><td class="state" colspan="7">読み込み中…</td></tr>
          } @else {
            @for (e of entries(); track e.id) {
              <tr class="row" [class.expandable]="e.detailText !== ''" (click)="toggle(e.id)">
                <td class="mono">{{ e.occurredAt.slice(0, 19).replace('T', ' ') }}</td>
                <td>{{ e.username }}</td>
                <td class="mono">{{ e.actionCode }}</td>
                <td class="mono">{{ e.operation }}</td>
                <td class="mono">{{ e.target }}</td>
                <td>
                  <span class="badge" [class.ok]="e.result === 'success'" [class.ng]="e.result === 'failure'">
                    {{ e.result }}
                  </span>
                  @if (e.errorCode) {
                    <span class="err-code">{{ e.errorCode }}</span>
                  }
                </td>
                <td class="mono muted">{{ e.clientIp }}</td>
              </tr>
              @if (expanded() === e.id && e.detailText !== '') {
                <tr class="detail-row">
                  <td colspan="7"><pre class="detail">{{ e.detailText }}</pre></td>
                </tr>
              }
            } @empty {
              <tr><td class="state" colspan="7">該当する履歴がありません</td></tr>
            }
          }
        </tbody>
      </table>

      <div class="footer">
        <span>{{ rangeLabel() }}</span>
        <span class="pager">
          <button class="pager-btn" type="button" [disabled]="page() <= 1"
            (click)="pageChanged.emit(page() - 1)" aria-label="前のページ">‹</button>
          {{ page() }} / {{ totalPages() }}
          <button class="pager-btn" type="button" [disabled]="page() >= totalPages()"
            (click)="pageChanged.emit(page() + 1)" aria-label="次のページ">›</button>
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
    }
    .input,
    .select {
      height: 32px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      background: var(--tm-surface);
      color: var(--tm-text);
    }
    .input {
      flex: 1;
    }
    .input:focus,
    .select:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: fixed;
    }
    .w80 { width: 80px; }
    .w110 { width: 110px; }
    .w150 { width: 150px; }
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
    .row.expandable {
      cursor: pointer;
    }
    .row.expandable:hover {
      background: var(--tm-primary-tint-weak);
    }
    .mono {
      font-family: var(--tm-font-mono);
    }
    .muted {
      color: var(--tm-text-muted);
    }
    .badge {
      font-size: 10px;
      border-radius: 3px;
      padding: 1px 6px;
    }
    .badge.ok {
      background: var(--tm-primary-tint);
      color: var(--tm-primary);
    }
    .badge.ng {
      background: var(--tm-danger-bg);
      color: var(--tm-danger);
    }
    .err-code {
      font-size: 10px;
      color: var(--tm-danger);
      margin-left: 4px;
    }
    .detail-row td {
      background: var(--tm-surface-alt);
      white-space: normal;
    }
    .detail {
      margin: 0;
      font-family: var(--tm-font-mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 240px;
      overflow-y: auto;
    }
    .state {
      text-align: center;
      color: var(--tm-text-muted);
      padding: 28px 10px;
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
export class HistoryPage {
  readonly entries = input<HistoryRow[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);

  readonly filterChanged = output<HistoryFilterChange>();
  readonly pageChanged = output<number>();

  protected readonly username = signal('');
  protected readonly actionCode = signal('');
  protected readonly result = signal<'' | 'success' | 'failure'>('');
  protected readonly expanded = signal<number | null>(null);

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.pageSize())),
  );

  protected readonly rangeLabel = computed(() => {
    const total = this.totalCount();
    if (total === 0) return '0件';
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return `${start}–${end} / ${total}件`;
  });

  protected emitFilter(): void {
    this.filterChanged.emit({
      username: this.username(),
      actionCode: this.actionCode(),
      result: this.result(),
    });
  }

  protected toggle(id: number): void {
    this.expanded.update((cur) => (cur === id ? null : id));
  }
}
