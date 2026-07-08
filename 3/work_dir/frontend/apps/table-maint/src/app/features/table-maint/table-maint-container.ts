// features/table-maint — メタデータ駆動のテーブルメンテナンス画面。
//
// tm-data-table-page(閲覧/検索/ページング) + tm-row-edit-dialog(追加/編集/削除)。
// 保存/削除は 1 操作ずつ batch API で即時反映する(単一Tx・楽観ロック付き)。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  ColumnDef,
  ConfirmDialog,
  DataTablePage,
  EditColumn,
  PageHeader,
  RowEditDialog,
  TableRow,
} from '@table-maint/ui';

import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import {
  ManagedTable,
  Row,
  TableMeta,
  apiErrorMessage,
} from '../../core/models';

const PAGE_SIZE = 50;
/** 表示行に埋め込む元データ参照キー(列に無いので描画されない)。 */
const ROW_INDEX_KEY = '$i';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-table-maint-container',
  imports: [DataTablePage, RowEditDialog, ConfirmDialog, PageHeader],
  template: `
    <tm-page-header
      pageTitle="テーブルメンテナンス"
      [userName]="userName()"
      (backClicked)="router.navigate(['/dashboard'])"
      (logoutClicked)="logout()"
    />

    <tm-data-table-page
      [tableNames]="tableNames()"
      [selectedTable]="selectedName()"
      [columns]="columnDefs()"
      [rows]="displayRows()"
      [totalCount]="total()"
      [page]="page()"
      [pageSize]="pageSize"
      [loading]="loading()"
      (tableChanged)="onTableChanged($event)"
      (searchChanged)="onSearchChanged($event)"
      (pageChanged)="onPageChanged($event)"
      (createClicked)="onCreate()"
      (rowSelected)="onRowSelected($event)"
    />

    <tm-row-edit-dialog
      [open]="dialogOpen()"
      [mode]="dialogMode()"
      [columns]="editColumns()"
      [value]="editValue()"
      [errorMessage]="dialogError()"
      [saving]="saving()"
      [canDelete]="writable()"
      (saved)="onSave($event)"
      (deleteClicked)="askDelete()"
      (cancelled)="closeDialog()"
    />

    <tm-confirm-dialog
      [open]="confirmOpen()"
      title="行の削除"
      message="この行を削除します。よろしいですか？"
      confirmLabel="削除"
      [danger]="true"
      [busy]="saving()"
      (confirmed)="onDelete()"
      (cancelled)="confirmOpen.set(false)"
    />
  `,
})
export class TableMaintContainer {
  protected readonly router = inject(Router);
  private auth = inject(AuthService);
  private api = inject(TablesApi);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');
  protected readonly writable = computed(() => this.auth.allows('table-maint', 'maintainer'));

  // ----------------------------------------------------------- 一覧状態
  protected readonly tables = signal<ManagedTable[]>([]);
  protected readonly selected = signal<ManagedTable | null>(null);
  protected readonly meta = signal<TableMeta | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly q = signal('');
  protected readonly loading = signal(false);

  protected readonly tableNames = computed(() => this.tables().map((t) => t.displayName));
  protected readonly selectedName = computed(() => this.selected()?.displayName ?? '');

  protected readonly columnDefs = computed<ColumnDef[]>(() => {
    const m = this.meta();
    if (!m) return [];
    return m.columns.map((c) => ({
      key: c.name,
      label: c.name,
      mono: c.type === 'uuid' || m.primaryKey.includes(c.name),
    }));
  });

  /** API の Row -> 表示用(文字列/数値)へ整形。$i で元 Row を引けるようにする。 */
  protected readonly displayRows = computed<TableRow[]>(() =>
    this.rows().map((r, i) => {
      const out: TableRow = { [ROW_INDEX_KEY]: i };
      for (const c of this.meta()?.columns ?? []) {
        out[c.name] = formatCell(r[c.name]);
      }
      return out;
    }),
  );

  protected readonly editColumns = computed<EditColumn[]>(
    () => (this.meta()?.columns ?? []) as EditColumn[],
  );

  // --------------------------------------------------------- ダイアログ
  protected readonly dialogOpen = signal(false);
  protected readonly dialogMode = signal<'create' | 'edit'>('create');
  protected readonly editValue = signal<Row>({});
  protected readonly dialogError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly confirmOpen = signal(false);
  /** 編集中の元 Row(削除/更新のキーと rowVersion 供給元)。 */
  private editingOriginal: Row | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const tables = await this.api.listTables();
      this.tables.set(tables);
      if (tables.length > 0) {
        await this.selectTable(tables[0]);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async selectTable(t: ManagedTable): Promise<void> {
    this.selected.set(t);
    this.page.set(1);
    this.q.set('');
    this.meta.set(await this.api.getMeta(t.id));
    await this.reload();
  }

  private async reload(): Promise<void> {
    const t = this.selected();
    if (!t) return;
    this.loading.set(true);
    try {
      const page = await this.api.listRows(t.id, {
        limit: PAGE_SIZE,
        offset: (this.page() - 1) * PAGE_SIZE,
        q: this.q() || undefined,
      });
      this.rows.set(page.rows);
      this.total.set(page.total);
    } finally {
      this.loading.set(false);
    }
  }

  // ------------------------------------------------------------ handlers

  protected async onTableChanged(displayName: string): Promise<void> {
    const t = this.tables().find((x) => x.displayName === displayName);
    if (t) await this.selectTable(t);
  }

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected onSearchChanged(q: string): void {
    // 入力のたびに叩かないよう 300ms デバウンス。
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.q.set(q);
      this.page.set(1);
      void this.reload();
    }, 300);
  }

  protected async onPageChanged(p: number): Promise<void> {
    this.page.set(p);
    await this.reload();
  }

  protected onCreate(): void {
    if (!this.writable()) return;
    this.dialogMode.set('create');
    this.editingOriginal = null;
    this.editValue.set(blankRow(this.meta()));
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected onRowSelected(display: TableRow): void {
    const i = display[ROW_INDEX_KEY];
    const original = typeof i === 'number' ? this.rows()[i] : undefined;
    if (!original) return;
    this.dialogMode.set('edit');
    this.editingOriginal = original;
    this.editValue.set({ ...original });
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.editingOriginal = null;
  }

  protected async onSave(draft: Row): Promise<void> {
    const t = this.selected();
    const m = this.meta();
    if (!t || !m) return;
    this.saving.set(true);
    this.dialogError.set(null);
    try {
      if (this.dialogMode() === 'create') {
        await this.api.applyBatch(t.id, { inserts: [editableOnly(draft, m)] });
      } else {
        const original = this.editingOriginal!;
        const changes = diffChanges(original, draft, m);
        if (Object.keys(changes).length > 0) {
          await this.api.applyBatch(t.id, {
            updates: [
              {
                key: pkOf(original, m),
                changes,
                rowVersion: rowVersionOf(original),
              },
            ],
          });
        }
      }
      this.closeDialog();
      await this.reload();
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err, '保存に失敗しました'));
    } finally {
      this.saving.set(false);
    }
  }

  protected askDelete(): void {
    this.confirmOpen.set(true);
  }

  protected async onDelete(): Promise<void> {
    const t = this.selected();
    const m = this.meta();
    const original = this.editingOriginal;
    if (!t || !m || !original) return;
    this.saving.set(true);
    try {
      await this.api.applyBatch(t.id, {
        deletes: [{ key: pkOf(original, m), rowVersion: rowVersionOf(original) }],
      });
      this.confirmOpen.set(false);
      this.closeDialog();
      await this.reload();
    } catch (err) {
      this.confirmOpen.set(false);
      this.dialogError.set(apiErrorMessage(err, '削除に失敗しました'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}

// ------------------------------------------------------------- helpers

function formatCell(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? '○' : '-';
  return String(v);
}

function blankRow(meta: TableMeta | null): Row {
  const out: Row = {};
  for (const c of meta?.columns ?? []) {
    if (!c.readonly) out[c.name] = c.type === 'bool' ? false : null;
  }
  return out;
}

/** readonly 列と予約キーを除いた insert ボディを作る。 */
function editableOnly(draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    out[c.name] = draft[c.name] ?? null;
  }
  return out;
}

/** 変更された編集可能列だけを changes に畳み込む。 */
function diffChanges(original: Row, draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    const before = original[c.name] ?? null;
    const after = draft[c.name] ?? null;
    if (before !== after) out[c.name] = after;
  }
  return out;
}

function pkOf(row: Row, meta: TableMeta): Row {
  const key: Row = {};
  for (const pk of meta.primaryKey) key[pk] = row[pk];
  return key;
}

/** rowversion は予約キー $rowVersion で行に同梱される。 */
function rowVersionOf(row: Row): string | undefined {
  const v = row['$rowVersion'];
  return typeof v === 'string' ? v : undefined;
}
