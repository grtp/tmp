// features/tables/row-utils.ts — 行データの整形/差分/主キー抽出(純粋関数)。
import { ColumnMeta, Row, TableMeta } from '../../core/models';

export function formatCell(v: unknown, type?: ColumnMeta['type']): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? '○' : '-';
  // datetime は ISO のまま(2026-07-18T19:52:47.9180829Z)だと読みにくいので
  // "yyyy-mm-dd hh:mm:ss" 形式へ(T→空白, 秒未満とタイムゾーンは切り捨て。
  // 値そのものの変換はしない: 表示だけを丸める)。
  if (type === 'datetime' && typeof v === 'string' && v.length >= 19) {
    return v.replace('T', ' ').slice(0, 19);
  }
  // date も API は "2026-07-21T00:00:00Z" 形式で返すため日付部分だけにする
  // (CSV 出力の表現とも一致する)。
  if (type === 'date' && typeof v === 'string' && v.length >= 10) {
    return v.slice(0, 10);
  }
  return String(v);
}

export function blankRow(meta: TableMeta | null): Row {
  const out: Row = {};
  for (const c of meta?.columns ?? []) {
    if (!c.readonly) out[c.name] = c.type === 'bool' ? false : null;
  }
  return out;
}

/** readonly 列と予約キーを除いた insert ボディを作る。 */
export function editableOnly(draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    out[c.name] = draft[c.name] ?? null;
  }
  return out;
}

/** 変更された編集可能列だけを changes に畳み込む。 */
export function diffChanges(original: Row, draft: Row, meta: TableMeta): Row {
  const out: Row = {};
  for (const c of meta.columns) {
    if (c.readonly) continue;
    const before = original[c.name] ?? null;
    const after = draft[c.name] ?? null;
    if (before !== after) out[c.name] = after;
  }
  return out;
}

export function pkOf(row: Row, meta: TableMeta): Row {
  const key: Row = {};
  for (const pk of meta.primaryKey) key[pk] = row[pk];
  return key;
}

/** rowversion は予約キー $rowVersion で行に同梱される。 */
export function rowVersionOf(row: Row): string | undefined {
  const v = row['$rowVersion'];
  return typeof v === 'string' ? v : undefined;
}
