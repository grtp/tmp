// features/table-maint/edit-buffer.ts
//
// 画面上の全行を pristine / added / modified / deleted の状態付きで保持し、
// [反映]時に BatchRequest(差分)へ畳み込む signal ストア。
// Result 型的に言えば「未確定の変更」を型で区別して持ち、確定(=DB反映)まで
// 副作用を遅延させる構造。
import { computed, signal } from '@angular/core';

import { BatchRequest, Row, TableMeta } from '../../core/models';

export type RowState = 'pristine' | 'added' | 'modified' | 'deleted';

export interface BufferRow {
  /** 既存行: PK値のJSON / 追加行: "new:n" */
  key: string;
  state: RowState;
  /** サーバーから来た原本(追加行は null)。差分判定と取消に使う。 */
  original: Row | null;
  /** 画面上の現在値 */
  current: Row;
}

let newSeq = 0;

export class EditBuffer {
  private rowsState = signal<BufferRow[]>([]);
  readonly rows = this.rowsState.asReadonly();

  readonly addedCount = computed(() => this.count('added'));
  readonly modifiedCount = computed(() => this.count('modified'));
  readonly deletedCount = computed(() => this.count('deleted'));
  readonly dirty = computed(
    () => this.addedCount() + this.modifiedCount() + this.deletedCount() > 0,
  );

  constructor(private meta: TableMeta) {}

  private count(state: RowState): number {
    return this.rowsState().reduce((n, r) => n + (r.state === state ? 1 : 0), 0);
  }

  // ---------------------------------------------------------- 取り込み

  /** ページ再取得(先頭から)。未反映の追加行は保持するか捨てるか選ぶ。 */
  reset(rows: Row[]): void {
    this.rowsState.set(rows.map((r) => this.pristineRow(r)));
    newSeq = 0;
  }

  /** 無限スクロールの追いロード分を末尾に足す(既存キーは重複させない)。 */
  append(rows: Row[]): void {
    const known = new Set(this.rowsState().map((r) => r.key));
    const fresh = rows
      .map((r) => this.pristineRow(r))
      .filter((r) => !known.has(r.key));
    this.rowsState.update((xs) => [...xs, ...fresh]);
  }

  // ------------------------------------------------------------ 編集

  /** 空の新規行を先頭に追加する。 */
  addRow(): void {
    const blank: Row = {};
    for (const c of this.meta.columns) {
      if (!c.readonly) blank[c.name] = c.type === 'bool' ? false : null;
    }
    const row: BufferRow = {
      key: `new:${++newSeq}`,
      state: 'added',
      original: null,
      current: blank,
    };
    this.rowsState.update((xs) => [row, ...xs]);
  }

  setValue(key: string, column: string, value: unknown): void {
    this.rowsState.update((xs) =>
      xs.map((r) => {
        if (r.key !== key || r.state === 'deleted') return r;
        const current = { ...r.current, [column]: value };
        if (r.state === 'added') return { ...r, current };
        const state: RowState = this.differs(r.original!, current) ? 'modified' : 'pristine';
        return { ...r, current, state };
      }),
    );
  }

  /** 削除マーク(追加行なら即座にバッファから消す)。 */
  markDeleted(key: string): void {
    this.rowsState.update((xs) =>
      xs.flatMap((r) => {
        if (r.key !== key) return [r];
        if (r.state === 'added') return []; // 未反映の追加は取り消しと同義
        return [{ ...r, state: 'deleted' as RowState }];
      }),
    );
  }

  /** 1行の変更を取り消して原本に戻す。 */
  revert(key: string): void {
    this.rowsState.update((xs) =>
      xs.flatMap((r) => {
        if (r.key !== key) return [r];
        if (r.original === null) return []; // 追加行は消える
        return [{ ...r, current: { ...r.original }, state: 'pristine' as RowState }];
      }),
    );
  }

  revertAll(): void {
    this.rowsState.update((xs) =>
      xs.flatMap((r) =>
        r.original === null
          ? []
          : [{ ...r, current: { ...r.original }, state: 'pristine' as RowState }],
      ),
    );
  }

  // ------------------------------------------------------------ 反映

  /**
   * 差分を BatchRequest に畳み込む。
   * updates.changes は変更された列だけ(全列送ると意図しない上書きが増える)。
   */
  toBatch(): BatchRequest {
    const inserts: Row[] = [];
    const updates: BatchRequest['updates'] = [];
    const deletes: BatchRequest['deletes'] = [];

    for (const r of this.rowsState()) {
      switch (r.state) {
        case 'added': {
          const row: Row = {};
          for (const c of this.meta.columns) {
            if (!c.readonly) row[c.name] = r.current[c.name] ?? null;
          }
          inserts.push(row);
          break;
        }
        case 'modified': {
          const changes: Row = {};
          for (const c of this.meta.columns) {
            if (c.readonly) continue;
            if (!this.same(r.original![c.name], r.current[c.name])) {
              changes[c.name] = r.current[c.name] ?? null;
            }
          }
          updates!.push({
            key: this.pkOf(r.original!),
            changes,
            rowVersion: this.rowVersionOf(r.original!),
          });
          break;
        }
        case 'deleted':
          deletes!.push({
            key: this.pkOf(r.original!),
            rowVersion: this.rowVersionOf(r.original!),
          });
          break;
      }
    }

    const out: BatchRequest = {};
    if (inserts.length) out.inserts = inserts;
    if (updates!.length) out.updates = updates;
    if (deletes!.length) out.deletes = deletes;
    return out;
  }

  /** required 列が空の追加/変更行があればエラーメッセージを返す。 */
  validate(): string | null {
    for (const r of this.rowsState()) {
      if (r.state !== 'added' && r.state !== 'modified') continue;
      for (const c of this.meta.columns) {
        if (!c.required || c.readonly) continue;
        const v = r.current[c.name];
        if (v === null || v === undefined || v === '') {
          return `「${c.displayName ?? c.name}」は必須です`;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------- helpers

  private pristineRow(r: Row): BufferRow {
    return { key: JSON.stringify(this.pkOf(r)), state: 'pristine', original: r, current: { ...r } };
  }

  private pkOf(r: Row): Row {
    const key: Row = {};
    for (const pk of this.meta.primaryKey) key[pk] = r[pk];
    return key;
  }

  /** rowversion は予約キー $rowVersion で行に同梱される(Phase 2 契約)。 */
  private rowVersionOf(r: Row): string | undefined {
    const v = r['$rowVersion'];
    return typeof v === 'string' ? v : undefined;
  }

  private differs(a: Row, b: Row): boolean {
    for (const c of this.meta.columns) {
      if (c.readonly) continue;
      if (!this.same(a[c.name], b[c.name])) return true;
    }
    return false;
  }

  private same(a: unknown, b: unknown): boolean {
    return (a ?? null) === (b ?? null);
  }
}
