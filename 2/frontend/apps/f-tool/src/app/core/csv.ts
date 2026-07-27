// core/csv.ts — CSV の生成・解析・ダウンロード。
//
// フォーマットは RFC 4180 準拠:
//   - 区切りはカンマ，改行は CRLF/LF 両対応(生成は CRLF)
//   - カンマ・引用符・改行を含むセルは "..." で括り，内部の " は "" にエスケープ
//   - 先頭の UTF-8 BOM は解析時に除去，生成時は excelCompat のときだけ付ける
// サーバーの export エンドポイントと同じ値表現(NULL=空文字, bool=true/false)。

/** RFC4180 の CSV を 2 次元配列にする。BOM は除去。空行はスキップ。 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    // 完全な空行(セル1個かつ空)は無視する
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    switch (ch) {
      case '"':
        inQuotes = true;
        i++;
        break;
      case ',':
        pushCell();
        i++;
        break;
      case '\r':
        if (text[i + 1] === '\n') i++;
        pushRow();
        i++;
        break;
      case '\n':
        pushRow();
        i++;
        break;
      default:
        cell += ch;
        i++;
    }
  }
  // 最終行(末尾改行なし)
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

/** ヘッダー + 行から CSV 文字列を作る(CRLF，RFC4180 エスケープ)。 */
export function buildCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header, ...rows].map((cols) => cols.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** CSV をファイルとしてダウンロードさせる。excelCompat=true で UTF-8 BOM を前置。 */
export function downloadCsv(filename: string, text: string, excelCompat: boolean): void {
  const parts: BlobPart[] = excelCompat ? ['﻿', text] : [text];
  const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
