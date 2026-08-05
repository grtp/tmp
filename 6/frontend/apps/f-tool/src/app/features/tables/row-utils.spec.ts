import { describe, expect, it } from 'vitest';

import { TableMeta } from '../../core/models';
import {
  blankRow,
  diffChanges,
  editableOnly,
  formatCell,
  pkOf,
  rowVersionOf,
} from './row-utils';

const meta: TableMeta = {
  id: 1,
  displayName: '商品',
  primaryKey: ['id'],
  writable: true,
  hasRowVersion: true,
  columns: [
    { name: 'id', type: 'int', nullable: false, readonly: true },
    { name: 'name', type: 'string', nullable: false, readonly: false },
    { name: 'active', type: 'bool', nullable: false, readonly: false },
    { name: 'updatedAt', type: 'datetime', nullable: true, readonly: false },
  ],
};

describe('formatCell', () => {
  it('null/undefined は空文字', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });
  it('数値はそのまま', () => {
    expect(formatCell(42)).toBe(42);
  });
  it('bool は ○/- へ変換', () => {
    expect(formatCell(true)).toBe('○');
    expect(formatCell(false)).toBe('-');
  });
  it('datetime は T→空白, 秒未満とタイムゾーンは切り捨て', () => {
    expect(formatCell('2026-07-18T19:52:47.9180829Z', 'datetime')).toBe(
      '2026-07-18 19:52:47',
    );
    expect(formatCell('2026-07-18T19:52:47.918+09:00', 'datetime')).toBe(
      '2026-07-18 19:52:47',
    );
  });
  it('datetime でも短い文字列(19文字未満)はそのまま', () => {
    expect(formatCell('2026-07-18', 'datetime')).toBe('2026-07-18');
  });
  it('date は日付部分だけにする(APIは 00:00:00Z 付き ISO で返す)', () => {
    expect(formatCell('2026-07-21T00:00:00Z', 'date')).toBe('2026-07-21');
    expect(formatCell('2026-07-21', 'date')).toBe('2026-07-21');
  });
  it('その他は String() 変換', () => {
    expect(formatCell('abc')).toBe('abc');
  });
});

describe('blankRow', () => {
  it('readonly 列を除いた空値の行を作る(bool は false,他は null)', () => {
    expect(blankRow(meta)).toEqual({ name: null, active: false, updatedAt: null });
  });
  it('meta が null なら空オブジェクト', () => {
    expect(blankRow(null)).toEqual({});
  });
});

describe('editableOnly', () => {
  it('readonly 列を除き,未指定は null で補う', () => {
    const draft = { id: 999, name: 'foo' };
    expect(editableOnly(draft, meta)).toEqual({
      name: 'foo',
      active: null,
      updatedAt: null,
    });
  });
});

describe('diffChanges', () => {
  it('変更された編集可能列だけを返す', () => {
    const original = { id: 1, name: 'foo', active: true, updatedAt: null };
    const draft = { id: 1, name: 'bar', active: true, updatedAt: null };
    expect(diffChanges(original, draft, meta)).toEqual({ name: 'bar' });
  });
  it('readonly 列は差分があっても無視する', () => {
    const original = { id: 1, name: 'foo' };
    const draft = { id: 2, name: 'foo' };
    expect(diffChanges(original, draft, meta)).toEqual({});
  });
  it('null と undefined は同値として扱う', () => {
    const original = { name: 'foo', active: undefined };
    const draft = { name: 'foo', active: null };
    expect(diffChanges(original, draft, meta)).toEqual({});
  });
});

describe('pkOf', () => {
  it('primaryKey に列挙された列だけを抽出する', () => {
    expect(pkOf({ id: 5, name: 'foo' }, meta)).toEqual({ id: 5 });
  });
});

describe('rowVersionOf', () => {
  it('$rowVersion が string なら返す', () => {
    expect(rowVersionOf({ $rowVersion: 'abc123' })).toBe('abc123');
  });
  it('無ければ undefined', () => {
    expect(rowVersionOf({})).toBeUndefined();
  });
});
