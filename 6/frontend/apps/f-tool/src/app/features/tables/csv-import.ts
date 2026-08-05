// features/tables/csv-import.ts — 取込 CSV の精査(ヘッダー突合・型検証・重複判定)。
//
// 方針:
//   - ヘッダーは列名で解決する(列順不問)。未知の列 / 必須列の欠落は取込中止
//   - セルは型ごとに検証し,エラーは行単位で記録(マージ画面でオレンジ表示 →
//     適応時に自動排除。backend でも必ず失敗するため)
//   - readonly 列(IDENTITY 等)は表示と重複判定にだけ使い,insert からは除外
//   - 重複判定は「フェッチ済みの行」との主キー照合(DB 全体とは照合しない。
//     残して保存した場合は batch API の単一 Tx が弾く)
import { ColumnMeta, Row, TableMeta } from '../../core/models';

/** マージ画面に渡す 1 行分。 */
export interface CsvImportRow {
  /** 列名→取込セル文字列(表示用。CSV に無い列は '') */
  display: Record<string, string>;
  /** insert に使う型付き値(editable 列のみ。型エラー行では不完全) */
  parsed: Row;
  /** フェッチ済み行と主キーが重複 */
  conflict: boolean;
  /** 型エラーの理由(非 null なら適応時に自動排除) */
  typeError?: string;
}

export type CsvValidation =
  | { ok: true; rows: CsvImportRow[] }
  | { ok: false; error: string };

export const CSV_IMPORT_MAX_ROWS = 10000;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * parseCsv 済みのレコード(先頭行 = ヘッダー)を meta と突合して検証する。
 * エラー文言は呼び出し側でそのまま表示する(i18n は簡略化して日本語固定にせず,
 * 列名などの動的部分のみ埋め込む)。
 */
export function validateCsvRecords(
  records: string[][],
  meta: TableMeta,
  labels: {
    empty: string;
    tooManyRows: string;
    unknownColumn: (name: string) => string;
    missingColumn: (name: string) => string;
    columnCount: (line: number) => string;
    badCell: (column: string, reason: string) => string;
    required: string;
    typeInt: string;
    typeDecimal: string;
    typeBool: string;
    typeDate: string;
    typeUuid: string;
  },
): CsvValidation {
  if (records.length < 2) {
    return { ok: false, error: labels.empty };
  }
  const [header, ...body] = records;
  if (body.length > CSV_IMPORT_MAX_ROWS) {
    return { ok: false, error: labels.tooManyRows };
  }

  const byName = new Map(meta.columns.map((c) => [c.name, c]));
  // header[ci] -> 列の解決をここで済ませておく(下の本読み込みループで
  // byName.get() を再度呼ぶと,検証済みのはずでも型上は undefined が
  // 消えないため非null断言が要る。配列にしておけば解決済みの ColumnMeta
  // がそのまま手に入る)。
  const headerCols: ColumnMeta[] = [];
  for (const h of header) {
    const col = byName.get(h);
    if (!col) {
      return { ok: false, error: labels.unknownColumn(h) };
    }
    headerCols.push(col);
  }
  const headerSet = new Set(header);
  for (const c of meta.columns) {
    // 必須(non-null かつデフォルト無し)の editable 列はヘッダーに必要。
    if (!c.readonly && c.required && !headerSet.has(c.name)) {
      return { ok: false, error: labels.missingColumn(c.name) };
    }
  }

  const rows: CsvImportRow[] = [];
  for (let li = 0; li < body.length; li++) {
    const rec = body[li];
    if (rec.length !== header.length) {
      return { ok: false, error: labels.columnCount(li + 2) }; // +2 = ヘッダー行 + 1-origin
    }
    const display: Record<string, string> = {};
    const parsed: Row = {};
    let typeError: string | undefined;

    for (let ci = 0; ci < header.length; ci++) {
      const col = headerCols[ci];
      const cell = rec[ci];
      display[col.name] = cell;
      if (col.readonly) continue; // IDENTITY 等は表示・重複判定のみ

      const r = parseCell(col, cell, labels);
      if (!r.ok) {
        typeError ??= labels.badCell(col.name, r.err);
        continue;
      }
      parsed[col.name] = r.value;
    }
    rows.push({ display, parsed, conflict: false, typeError });
  }
  return { ok: true, rows };
}

/**
 * 主キーがフェッチ済み行と一致する行に conflict を立てる(in place)。
 * 主キーが自動採番(readonly)のテーブルでは CSV の値と無関係に新しいキーが
 * 振られるため,重複判定はしない(CSV の ID は無視される)。
 */
export function markConflicts(
  rows: CsvImportRow[],
  meta: TableMeta,
  fetched: Row[],
): number {
  const pk = meta.primaryKey;
  if (pk.length === 0 || fetched.length === 0) return 0;
  const byName = new Map(meta.columns.map((c) => [c.name, c]));
  if (pk.some((k) => byName.get(k)?.readonly)) return 0;
  const keys = new Set(
    fetched.map((r) => pk.map((k) => keyPart(r[k])).join('\0')),
  );
  let n = 0;
  for (const row of rows) {
    const key = pk.map((k) => keyPart(row.display[k])).join('\0');
    row.conflict = keys.has(key);
    if (row.conflict) n++;
  }
  return n;
}

/** 主キー値の比較用正規化(数値/文字列の揺れと大文字小文字を吸収)。 */
function keyPart(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}

type CellResult = { ok: true; value: unknown } | { ok: false; err: string };

const ok = (value: unknown): CellResult => ({ ok: true, value });
const ng = (err: string): CellResult => ({ ok: false, err });

/** セルを列型に応じて検証し,insert 用の値へ変換する。 */
function parseCell(
  col: ColumnMeta,
  cell: string,
  labels: {
    required: string;
    typeInt: string;
    typeDecimal: string;
    typeBool: string;
    typeDate: string;
    typeUuid: string;
  },
): CellResult {
  const s = cell.trim();
  if (s === '') {
    if (col.required) return ng(labels.required);
    return ok(null);
  }
  switch (col.type) {
    case 'int': {
      if (!/^[+-]?\d+$/.test(s)) return ng(labels.typeInt);
      return ok(Number(s));
    }
    case 'decimal': {
      const f = Number(s);
      if (!isFinite(f)) return ng(labels.typeDecimal);
      return ok(f);
    }
    case 'bool': {
      const lo = s.toLowerCase();
      if (lo === 'true' || lo === '1') return ok(true);
      if (lo === 'false' || lo === '0') return ok(false);
      return ng(labels.typeBool);
    }
    case 'date':
    case 'datetime': {
      // ISO 8601(YYYY-MM-DD / RFC3339)を受け付ける。値はそのまま送り
      // 最終的な妥当性は backend の coerce に委ねる。
      if (isNaN(Date.parse(s))) return ng(labels.typeDate);
      return ok(s);
    }
    case 'uuid': {
      if (!UUID_RE.test(s)) return ng(labels.typeUuid);
      return ok(s);
    }
    default:
      return ok(cell); // string はそのまま(trim しない)
  }
}
