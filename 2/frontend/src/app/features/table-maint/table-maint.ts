// features/table-maint/table-maint.ts
// メタデータ駆動の動的テーブル。1コンポーネントで全テーブルを描画するため、
// テーブル追加(YAML+再ビルド)時にフロントの変更は不要。
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import {
  ColumnMeta,
  Row,
  TableMeta,
  TableSummary,
  apiErrorMessage,
} from '../../core/models';
import { BufferRow, EditBuffer } from './edit-buffer';

const PAGE_SIZES = [10, 20, 50, 100, 200] as const;

@Component({
  selector: 'app-table-maint',
  templateUrl: './table-maint.html',
  styleUrl: './table-maint.css',
})
export class TableMaint {
  private api = inject(TablesApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly auth = inject(AuthService);

  readonly pageSizes = PAGE_SIZES;

  // ---- 一覧・選択 ----
  readonly tables = signal<TableSummary[]>([]);
  readonly selectedName = signal<string | null>(null);
  readonly meta = signal<TableMeta | null>(null);

  // ---- データ・バッファ ----
  buffer: EditBuffer | null = null;
  readonly bufferRows = signal<BufferRow[]>([]);
  readonly total = signal(0);
  readonly loadedCount = signal(0); // サーバーから取得済みの行数(offset)
  readonly hasMore = computed(() => this.loadedCount() < this.total());

  // ---- 取得条件 ----
  readonly pageSize = signal<number>(100);
  readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- 画面状態 ----
  readonly loading = signal(false);
  readonly applying = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly confirmOpen = signal(false);

  readonly writable = computed(() => this.meta()?.writable ?? false);
  readonly dirtyCounts = computed(() => {
    // bufferRows の変化で再計算させるため signal 経由で読む
    const rows = this.bufferRows();
    let added = 0, modified = 0, deleted = 0;
    for (const r of rows) {
      if (r.state === 'added') added++;
      else if (r.state === 'modified') modified++;
      else if (r.state === 'deleted') deleted++;
    }
    return { added, modified, deleted, dirty: added + modified + deleted > 0 };
  });

  constructor() {
    void this.init();
    // URLの ?table= と選択を同期(リロード・ブックマーク対応)
    effect(() => {
      const name = this.selectedName();
      if (name) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { table: name },
          replaceUrl: true,
        });
      }
    });
  }

  private async init(): Promise<void> {
    try {
      const tables = await this.api.listTables();
      this.tables.set(tables);
      const fromUrl = this.route.snapshot.queryParamMap.get('table');
      const initial =
        tables.find((t) => t.name === fromUrl)?.name ?? tables[0]?.name ?? null;
      if (initial) await this.select(initial);
    } catch (e) {
      this.error.set(apiErrorMessage(e, 'テーブル一覧の取得に失敗しました'));
    }
  }

  async select(name: string): Promise<void> {
    if (this.dirtyCounts().dirty && !confirm('未反映の変更があります。破棄して切り替えますか？')) {
      return;
    }
    this.selectedName.set(name);
    this.error.set(null);
    this.notice.set(null);
    this.loading.set(true);
    try {
      const meta = await this.api.getMeta(name);
      this.meta.set(meta);
      this.buffer = new EditBuffer(meta);
      await this.loadFirstPage();
    } catch (e) {
      this.error.set(apiErrorMessage(e, 'テーブル情報の取得に失敗しました'));
      this.meta.set(null);
      this.buffer = null;
      this.bufferRows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  // ------------------------------------------------------------ 取得

  private async loadFirstPage(): Promise<void> {
    const name = this.selectedName();
    if (!name || !this.buffer) return;
    const page = await this.api.listRows(name, {
      limit: this.pageSize(),
      offset: 0,
      q: this.search() || undefined,
    });
    this.buffer.reset(page.rows);
    this.syncFromBuffer();
    this.total.set(page.total);
    this.loadedCount.set(page.rows.length);
  }

  /** 無限スクロール: 末尾近くで次ページを追いロード。 */
  async onScroll(ev: Event): Promise<void> {
    const el = ev.target as HTMLElement;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
    if (!nearBottom || this.loading() || !this.hasMore()) return;

    const name = this.selectedName();
    if (!name || !this.buffer) return;
    this.loading.set(true);
    try {
      const page = await this.api.listRows(name, {
        limit: this.pageSize(),
        offset: this.loadedCount(),
        q: this.search() || undefined,
      });
      this.buffer.append(page.rows);
      this.syncFromBuffer();
      this.total.set(page.total);
      this.loadedCount.set(this.loadedCount() + page.rows.length);
    } catch (e) {
      this.error.set(apiErrorMessage(e, '追加読み込みに失敗しました'));
    } finally {
      this.loading.set(false);
    }
  }

  async reload(): Promise<void> {
    if (this.dirtyCounts().dirty && !confirm('未反映の変更があります。破棄して再読込しますか？')) {
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.loadFirstPage();
    } catch (e) {
      this.error.set(apiErrorMessage(e, '再読込に失敗しました'));
    } finally {
      this.loading.set(false);
    }
  }

  onPageSizeChange(size: string): void {
    this.pageSize.set(Number(size));
    void this.reload();
  }

  onSearchInput(q: string): void {
    this.search.set(q);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.reload(), 350);
  }

  // ------------------------------------------------------------ 編集

  addRow(): void {
    this.buffer?.addRow();
    this.syncFromBuffer();
  }

  onCellInput(key: string, col: ColumnMeta, raw: string | boolean): void {
    this.buffer?.setValue(key, col.name, coerce(col, raw));
    this.syncFromBuffer();
  }

  markDeleted(key: string): void {
    this.buffer?.markDeleted(key);
    this.syncFromBuffer();
  }

  revert(key: string): void {
    this.buffer?.revert(key);
    this.syncFromBuffer();
  }

  revertAll(): void {
    if (!confirm('全ての未反映の変更を取り消しますか？')) return;
    this.buffer?.revertAll();
    this.syncFromBuffer();
  }

  private syncFromBuffer(): void {
    this.bufferRows.set(this.buffer ? [...this.buffer.rows()] : []);
  }

  // ------------------------------------------------------------ 反映

  openConfirm(): void {
    const msg = this.buffer?.validate();
    if (msg) {
      this.error.set(msg);
      return;
    }
    this.error.set(null);
    this.confirmOpen.set(true);
  }

  async apply(): Promise<void> {
    const name = this.selectedName();
    if (!name || !this.buffer) return;
    this.applying.set(true);
    this.error.set(null);
    try {
      const result = await this.api.applyBatch(name, this.buffer.toBatch());
      this.confirmOpen.set(false);
      this.notice.set(
        `反映しました: 追加 ${result.inserted} / 更新 ${result.updated} / 削除 ${result.deleted}`,
      );
      await this.loadFirstPage(); // 反映後はサーバーの正で再同期
    } catch (e) {
      this.error.set(apiErrorMessage(e, '反映に失敗しました。全ての変更はロールバックされています'));
      this.confirmOpen.set(false);
    } finally {
      this.applying.set(false);
    }
  }

  // ------------------------------------------------------------ 表示

  cellText(row: BufferRow, col: ColumnMeta): string {
    const v = row.current[col.name];
    if (v === null || v === undefined) return '';
    return String(v);
  }

  boolValue(row: BufferRow, col: ColumnMeta): boolean {
    return row.current[col.name] === true;
  }

  isEditable(col: ColumnMeta): boolean {
    return this.writable() && !col.readonly;
  }

  inputType(col: ColumnMeta): string {
    switch (col.type) {
      case 'int':
      case 'decimal':
        return 'number';
      case 'date':
        return 'date';
      case 'datetime':
        return 'datetime-local';
      default:
        return 'text';
    }
  }
}

/** 入力値を ColumnMeta.type に従って API 値へ変換する。 */
function coerce(col: ColumnMeta, raw: string | boolean): unknown {
  if (col.type === 'bool') return raw === true;
  const s = String(raw);
  if (s === '') return null;
  if (col.type === 'int') {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (col.type === 'decimal') {
    const n = Number.parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }
  return s;
}

export type { Row };
