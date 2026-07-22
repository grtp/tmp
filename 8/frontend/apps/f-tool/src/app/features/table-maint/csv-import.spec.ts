import { describe, expect, it } from 'vitest';

import {
  CSV_IMPORT_MAX_ROWS,
  CsvImportRow,
  markConflicts,
  validateCsvRecords,
} from './csv-import';
import { ColumnMeta, TableMeta } from '../../core/models';

const labels = {
  empty: 'EMPTY',
  tooManyRows: 'TOO_MANY',
  unknownColumn: (name: string) => `UNKNOWN:${name}`,
  missingColumn: (name: string) => `MISSING:${name}`,
  columnCount: (line: number) => `COUNT:${line}`,
  badCell: (column: string, reason: string) => `BAD:${column}:${reason}`,
  required: 'REQUIRED',
  typeInt: 'INT',
  typeDecimal: 'DECIMAL',
  typeBool: 'BOOL',
  typeDate: 'DATE',
  typeUuid: 'UUID',
};

function col(partial: Partial<ColumnMeta> & { name: string }): ColumnMeta {
  return { type: 'string', nullable: true, readonly: false, ...partial };
}

function tableMeta(
  columns: ColumnMeta[],
  primaryKey: string[] = ['id'],
): TableMeta {
  return {
    id: 1,
    displayName: 't',
    primaryKey,
    writable: true,
    hasRowVersion: false,
    columns,
  };
}

const meta = tableMeta([
  col({ name: 'id', type: 'int', readonly: true }),
  col({ name: 'name', required: true, nullable: false }),
  col({ name: 'qty', type: 'int' }),
  col({ name: 'price', type: 'decimal' }),
  col({ name: 'active', type: 'bool' }),
  col({ name: 'due', type: 'date' }),
  col({ name: 'guid', type: 'uuid' }),
]);

describe('validateCsvRecords', () => {
  it('ヘッダーのみ / 空入力は中止する', () => {
    expect(validateCsvRecords([], meta, labels)).toEqual({
      ok: false,
      error: 'EMPTY',
    });
    expect(validateCsvRecords([['id', 'name']], meta, labels)).toEqual({
      ok: false,
      error: 'EMPTY',
    });
  });

  it('上限行数ちょうどは許可し，超過は中止する', () => {
    const header = ['name'];
    const atCap = [
      header,
      ...Array.from({ length: CSV_IMPORT_MAX_ROWS }, () => ['x']),
    ];
    expect(validateCsvRecords(atCap, meta, labels).ok).toBe(true);
    const overCap = [...atCap, ['y']];
    expect(validateCsvRecords(overCap, meta, labels)).toEqual({
      ok: false,
      error: 'TOO_MANY',
    });
  });

  it('未知の列は中止する', () => {
    expect(validateCsvRecords([['ghost'], ['1']], meta, labels)).toEqual({
      ok: false,
      error: 'UNKNOWN:ghost',
    });
  });

  it('必須 editable 列の欠落は中止する(readonly の必須は不要)', () => {
    expect(validateCsvRecords([['qty'], ['1']], meta, labels)).toEqual({
      ok: false,
      error: 'MISSING:name',
    });
  });

  it('列数不一致は 1-origin + ヘッダー行込みの行番号で中止する', () => {
    const records = [['name', 'qty'], ['a', '1'], ['b']];
    expect(validateCsvRecords(records, meta, labels)).toEqual({
      ok: false,
      error: 'COUNT:3',
    });
  });

  it('readonly 列は display に残り parsed から除外される', () => {
    const r = validateCsvRecords(
      [
        ['id', 'name'],
        ['7', 'a'],
      ],
      meta,
      labels,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0].display).toEqual({ id: '7', name: 'a' });
    expect(r.rows[0].parsed).toEqual({ name: 'a' });
  });

  it('型ごとにセルを解釈する(int/decimal/bool/date/uuid/空=null)', () => {
    const guid = '01234567-89ab-cdef-0123-456789abcdef';
    const r = validateCsvRecords(
      [
        ['name', 'qty', 'price', 'active', 'due', 'guid'],
        ['a', '42', '1.5', 'TRUE', '2026-07-20', guid],
        ['b', '', '', '0', '', ''],
      ],
      meta,
      labels,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0].parsed).toEqual({
      name: 'a',
      qty: 42,
      price: 1.5,
      active: true,
      due: '2026-07-20',
      guid,
    });
    expect(r.rows[0].typeError).toBeUndefined();
    expect(r.rows[1].parsed).toEqual({
      name: 'b',
      qty: null,
      price: null,
      active: false,
      due: null,
      guid: null,
    });
  });

  it('型エラーは行単位で最初の理由を記録する(中止はしない)', () => {
    const r = validateCsvRecords(
      [
        ['name', 'qty', 'active'],
        ['a', '1.5', 'yes'],
        ['', '1', 'true'],
        ['c', 'x', 'true'],
      ],
      meta,
      labels,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0].typeError).toBe('BAD:qty:INT');
    expect(r.rows[1].typeError).toBe('BAD:name:REQUIRED');
    expect(r.rows[2].typeError).toBe('BAD:qty:INT');
    expect(r.rows[2].parsed).toEqual({ name: 'c', active: true });
  });

  it('string セルは trim しない(前後空白を保持)', () => {
    const r = validateCsvRecords([['name'], [' a ']], meta, labels);
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0].parsed).toEqual({ name: ' a ' });
  });
});

function importRow(display: Record<string, string>): CsvImportRow {
  return { display, parsed: {}, conflict: false };
}

describe('markConflicts', () => {
  const writableMeta = tableMeta(
    [
      col({ name: 'code', required: true, nullable: false }),
      col({ name: 'name' }),
    ],
    ['code'],
  );

  it('フェッチ済み行と主キー一致で conflict を立てる(大小・空白は無視)', () => {
    const rows = [importRow({ code: ' ABC ' }), importRow({ code: 'zzz' })];
    const n = markConflicts(rows, writableMeta, [
      { code: 'abc' },
      { code: 'def' },
    ]);
    expect(n).toBe(1);
    expect(rows.map((r) => r.conflict)).toEqual([true, false]);
  });

  it('複合主キーは全列一致で判定する', () => {
    const m = tableMeta([col({ name: 'a' }), col({ name: 'b' })], ['a', 'b']);
    const rows = [importRow({ a: '1', b: '2' }), importRow({ a: '1', b: '9' })];
    const n = markConflicts(rows, m, [{ a: 1, b: 2 }]);
    expect(n).toBe(1);
    expect(rows.map((r) => r.conflict)).toEqual([true, false]);
  });

  it('自動採番(readonly)主キーのテーブルでは判定しない', () => {
    const rows = [importRow({ id: '1' })];
    expect(markConflicts(rows, meta, [{ id: 1 }])).toBe(0);
    expect(rows[0].conflict).toBe(false);
  });

  it('フェッチ済み行が無ければ何もしない', () => {
    const rows = [importRow({ code: 'abc' })];
    expect(markConflicts(rows, writableMeta, [])).toBe(0);
  });
});
