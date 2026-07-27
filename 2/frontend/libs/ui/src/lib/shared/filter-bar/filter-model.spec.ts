import { describe, expect, it } from 'vitest';

import {
  FilterColumn,
  chipText,
  defaultDraft,
  draftFromPredicate,
  draftToPredicate,
  opsFor,
  toPredsParam,
  valueOk,
} from './filter-model';

const strCol: FilterColumn = { key: 'code', label: 'code', type: 'string' };
const intCol: FilterColumn = { key: 'val', label: 'val', type: 'int' };
const boolCol: FilterColumn = { key: 'ok', label: 'ok', type: 'bool' };
const dateCol: FilterColumn = { key: 'day', label: 'day', type: 'date' };
const enumCol: FilterColumn = {
  key: 'result',
  label: '成否',
  type: 'enum',
  enumValues: [
    { value: 'success', label: '成功' },
    { value: 'failure', label: '失敗' },
  ],
};

describe('opsFor', () => {
  it('string は contains が既定', () => {
    expect(opsFor('string')[0]).toBe('contains');
  });
  it('bool/enum/uuid は eq のみ', () => {
    expect(opsFor('bool')).toEqual(['eq']);
    expect(opsFor('enum')).toEqual(['eq']);
    expect(opsFor('uuid')).toEqual(['eq']);
  });
});

describe('draftToPredicate', () => {
  it('カンマ区切りを OR 値に分割し空要素は捨てる', () => {
    const p = draftToPredicate(strCol, { op: 'contains', v1: ' a, ,b ', v2: '', negate: false });
    expect(p).toEqual({ column: 'code', op: 'contains', values: ['a', 'b'] });
  });

  it('negate は true のときだけ載せる', () => {
    const p = draftToPredicate(strCol, { op: 'eq', v1: 'x', v2: '', negate: true });
    expect(p?.negate).toBe(true);
    const q = draftToPredicate(strCol, { op: 'eq', v1: 'x', v2: '', negate: false });
    expect('negate' in (q ?? {})).toBe(false);
  });

  it('range は両端必須で values [min,max]', () => {
    expect(draftToPredicate(intCol, { op: 'range', v1: '10', v2: '', negate: false })).toBeNull();
    const p = draftToPredicate(intCol, { op: 'range', v1: ' 10 ', v2: '20', negate: false });
    expect(p?.values).toEqual(['10', '20']);
  });

  it('int の型不一致は null', () => {
    expect(draftToPredicate(intCol, { op: 'eq', v1: 'x', v2: '', negate: false })).toBeNull();
    expect(draftToPredicate(intCol, { op: 'eq', v1: '1, z', v2: '', negate: false })).toBeNull();
  });

  it('bool はカンマ分割しない(単一値)', () => {
    const p = draftToPredicate(boolCol, { op: 'eq', v1: 'true', v2: '', negate: false });
    expect(p?.values).toEqual(['true']);
  });

  it('空値は null', () => {
    expect(draftToPredicate(strCol, { op: 'contains', v1: ' , ', v2: '', negate: false })).toBeNull();
  });
});

describe('draftFromPredicate (チップ再編集の往復)', () => {
  it('eq/contains は values をカンマ結合で戻す', () => {
    const d = draftFromPredicate({ column: 'code', op: 'contains', values: ['a', 'b'], negate: true });
    expect(d).toEqual({ op: 'contains', v1: 'a, b', v2: '', negate: true });
    expect(draftToPredicate(strCol, d)).toEqual({
      column: 'code', op: 'contains', values: ['a', 'b'], negate: true,
    });
  });
  it('range は v1/v2 に分解する', () => {
    const d = draftFromPredicate({ column: 'val', op: 'range', values: ['1', '9'] });
    expect(d.v1).toBe('1');
    expect(d.v2).toBe('9');
  });
});

describe('defaultDraft', () => {
  it('bool は true,enum は先頭候補を選択済みにする', () => {
    expect(defaultDraft(boolCol).v1).toBe('true');
    expect(defaultDraft(enumCol).v1).toBe('success');
  });
});

describe('valueOk', () => {
  it('日付は YYYY-MM-DD のみ', () => {
    expect(valueOk('date', '2026-07-01')).toBe(true);
    expect(valueOk('date', '2026/07/01')).toBe(false);
  });
  it('decimal は数値として解釈できること', () => {
    expect(valueOk('decimal', '1.5')).toBe(true);
    expect(valueOk('decimal', '1,5')).toBe(false);
  });
});

describe('chipText', () => {
  it('contains はコロン区切り', () => {
    expect(chipText(strCol, { column: 'code', op: 'contains', values: ['B-1', 'C'] }, '(除外)'))
      .toBe('code: B-1, C');
  });
  it('比較は記号,range は〜', () => {
    expect(chipText(intCol, { column: 'val', op: 'gt', values: ['10'] }, '')).toBe('val > 10');
    expect(chipText(dateCol, { column: 'day', op: 'range', values: ['2026-07-01', '2026-07-31'] }, ''))
      .toBe('day: 2026-07-01〜2026-07-31');
  });
  it('enum は表示ラベルへ変換,negate はサフィックス付与', () => {
    expect(chipText(enumCol, { column: 'result', op: 'eq', values: ['failure'], negate: true }, '(除外)'))
      .toBe('成否 = 失敗(除外)');
  });
});

describe('toPredsParam', () => {
  it('空配列は undefined', () => {
    expect(toPredsParam([])).toBeUndefined();
    expect(JSON.parse(toPredsParam([{ column: 'a', op: 'eq', values: ['1'] }])!)).toEqual([
      { column: 'a', op: 'eq', values: ['1'] },
    ]);
  });
});
