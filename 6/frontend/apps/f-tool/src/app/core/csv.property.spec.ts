// parseCsv / buildCsv のプロパティテスト。ユーザーが持ち込む任意の CSV を
// 食べる唯一の入口なので,既知ケース(csv.spec.ts)に加えて生成入力で性質を検証する。
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildCsv, parseCsv } from './csv';

// セル: 制御文字を含む任意の文字列(カンマ・引用符・改行・CR を明示的に混ぜる)
const cell = fc.oneof(
  fc.string(),
  fc.constantFrom('', ',', '"', '\n', '\r\n', 'a,"b"\nc', ',や。を含む日本語'),
);
// 行: 1セル以上。単一空セル行([''])は「空行はスキップ」仕様と衝突するため除外
const row = fc.array(cell, { minLength: 1, maxLength: 8 }).filter((r) => !(r.length === 1 && r[0] === ''));
const header = fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 8 });

describe('csv プロパティ', () => {
  it('ラウンドトリップ: parseCsv(buildCsv(h, rows)) === [h, ...rows]', () => {
    fc.assert(
      fc.property(
        header.filter((h) => !(h.length === 1 && h[0] === '')),
        fc.array(row, { maxLength: 20 }),
        (h, rows) => {
          expect(parseCsv(buildCsv(h, rows))).toEqual([h, ...rows]);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('parseCsv は任意の文字列入力で例外を投げない', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseCsv(s);
      }),
      { numRuns: 1000 },
    );
  });

  it('parseCsv の結果は常に string[][] で空行を含まない', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const r of parseCsv(s)) {
          expect(Array.isArray(r)).toBe(true);
          expect(r.length === 1 && r[0] === '').toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });
});
