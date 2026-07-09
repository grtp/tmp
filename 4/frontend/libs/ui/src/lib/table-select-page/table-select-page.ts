import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** カード1枚 = 管理対象テーブル。 */
export interface TableCard {
  id: number;
  displayName: string;
  schemaName: string;
  tableName: string;
  description?: string;
  /** 接続の表示名(既定DBは undefined) */
  connectionName?: string;
}

/**
 * テーブルメンテナンスの入口: 編集対象テーブルをカードで選ぶ。
 * (プルダウン選択の置き換え。ダッシュボードのカードと同じ視覚言語)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-select-page',
  imports: [TranslocoPipe],
  template: `
    <div class="wrap">
      @if (loading()) {
        <p class="state">{{ 'common.loading' | transloco }}</p>
      } @else {
        <div class="cards">
          @for (t of tables(); track t.id) {
            <button class="card" type="button" (click)="tableSelected.emit(t.id)">
              <span class="card-head">
                <i class="card-icon ti ti-table" aria-hidden="true"></i>
                @if (t.connectionName) {
                  <span class="conn-badge">{{ t.connectionName }}</span>
                } @else {
                  <span class="conn-badge default">{{ 'common.defaultDb' | transloco }}</span>
                }
              </span>
              <span class="card-name">{{ t.displayName }}</span>
              <span class="card-table mono">{{ t.schemaName }}.{{ t.tableName }}</span>
              @if (t.description) {
                <span class="card-desc">{{ t.description }}</span>
              }
            </button>
          } @empty {
            <p class="empty">{{ 'tableSelect.empty' | transloco }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap {
      padding: 16px;
    }
    .state {
      color: var(--tm-text-muted);
      font-size: 13px;
      text-align: center;
      padding: 28px 0;
      margin: 0;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .card {
      font-family: inherit;
      text-align: left;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .card:hover {
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-icon {
      font-size: 22px;
      color: var(--tm-primary);
    }
    .conn-badge {
      font-size: 10px;
      background: var(--tm-primary-tint);
      color: var(--tm-primary);
      border-radius: 3px;
      padding: 1px 6px;
      white-space: nowrap;
    }
    .conn-badge.default {
      background: var(--tm-surface-alt);
      color: var(--tm-text-muted);
    }
    .card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
    }
    .card-table {
      font-size: 11px;
      color: var(--tm-text-secondary);
    }
    .mono {
      font-family: var(--tm-font-mono);
    }
    .card-desc {
      font-size: 11px;
      color: var(--tm-text-muted);
    }
    .empty {
      grid-column: 1 / -1;
      font-size: 13px;
      color: var(--tm-text-muted);
      border: 1px dashed var(--tm-border-strong);
      border-radius: var(--tm-radius);
      padding: 24px;
      text-align: center;
      margin: 0;
    }
  `,
})
export class TableSelectPage {
  readonly tables = input<TableCard[]>([]);
  readonly loading = input(false);

  /** カード選択(管理テーブル id を通知) */
  readonly tableSelected = output<number>();
}
