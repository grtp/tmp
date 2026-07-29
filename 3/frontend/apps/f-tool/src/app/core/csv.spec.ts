import { describe, expect, it } from 'vitest';

import { buildCsv, parseCsv } from './csv';

describe('parseCsv', () => {
  it('カンマ区切りの素朴な CSV を分解する', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('先頭の UTF-8 BOM を除去する', () => {
    expect(parseCsv('﻿a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('CRLF と LF の混在を受け付ける', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('引用符内のカンマ・改行・"" エスケープを解釈する', () => {
    expect(parseCsv('"a,1","b\nc","say ""hi"""\n')).toEqual([['a,1', 'b\nc', 'say "hi"']]);
  });

  it('引用符内の CRLF はセル値として保持される', () => {
    expect(parseCsv('"x\r\ny",z\n')).toEqual([['x\r\ny', 'z']]);
  });

  it('完全な空行はスキップし，空セルは保持する', () => {
    expect(parseCsv('a,b\n\n,2\n')).toEqual([
      ['a', 'b'],
      ['', '2'],
    ]);
  });

  it('末尾に改行が無い最終行も取り込む', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('空文字列は空配列になる', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('buildCsv', () => {
  it('CRLF 区切り + 末尾改行で生成する', () => {
    expect(buildCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });

  it('カンマ・引用符・改行を含むセルだけを引用する', () => {
    expect(buildCsv(['h'], [['a,1'], ['say "hi"'], ['x\ny'], ['plain']])).toBe(
      'h\r\n"a,1"\r\n"say ""hi"""\r\n"x\ny"\r\nplain\r\n',
    );
  });

  it('null / undefined は空文字，bool は true/false になる', () => {
    expect(buildCsv(['a', 'b', 'c', 'd'], [[null, undefined, true, false]])).toBe(
      'a,b,c,d\r\n,,true,false\r\n',
    );
  });

  it('parseCsv とのラウンドトリップで元に戻る', () => {
    const header = ['id', 'name', 'note'];
    const rows = [
      ['1', 'カンマ,入り', '改行\n入り'],
      ['2', '引用"入り', ''],
    ];
    expect(parseCsv(buildCsv(header, rows))).toEqual([header, ...rows]);
  });
});
