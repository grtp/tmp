import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
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
  /** 管理対象への登録日時(ISO) */
  createdAt: string;
  /** このテーブルへの直近の操作成功日時(ISO)。操作履歴が無ければ undefined */
  lastActivityAt?: string;
}

type ViewMode = 'card' | 'list';

const VIEW_MODE_KEY = 'ftool.tableSelect.view';

/**
 * テーブル管理の入口: 編集対象テーブルをカードで選ぶ。
 * (プルダウン選択の置き換え。ダッシュボードのカードと同じ視覚言語)
 * 検索(表示名/schema.table)・カード/リスト表示切替(端末に永続化)を持つ。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-select-page',
  imports: [DatePipe, MatIcon, TranslocoPipe],
  templateUrl: './table-select-page.html',
  styleUrl: './table-select-page.css',
})
export class TableSelectPage {
  readonly tables = input<TableCard[]>([]);
  readonly loading = input(false);
  /** true なら0件時に設定画面への導線ボタンを出す(settings:admin のみ) */
  readonly canManage = input(false);

  /** カード選択(管理テーブル id を通知) */
  readonly tableSelected = output<number>();
  /** 0件時の導線ボタン押下(遷移はコンテナの責務) */
  readonly manageClicked = output<void>();

  protected readonly query = signal('');
  protected readonly view = signal<ViewMode>(this.loadView());

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (q === '') return this.tables();
    return this.tables().filter((t) => {
      const hay = `${t.displayName} ${t.schemaName}.${t.tableName}`.toLowerCase();
      return hay.includes(q);
    });
  });

  protected onQueryInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }

  protected setView(v: ViewMode): void {
    this.view.set(v);
    try {
      localStorage.setItem(VIEW_MODE_KEY, v);
    } catch {
      // プライベートブラウズ等でストレージが使えなくても致命的ではない
    }
  }

  private loadView(): ViewMode {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'card';
    } catch {
      return 'card';
    }
  }
}
