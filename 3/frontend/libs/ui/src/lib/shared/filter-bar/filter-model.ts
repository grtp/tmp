// チップフィルタの述語モデル(純関数)。
// バックエンド internal/predicate と同じ語彙(op/values/negate)を使い,
// どのグリッド実装(tm-grid / 将来の AG Grid 画面)からも共有する。
// コンポーネント(filter-bar.ts)は表示と編集だけを担い,変換ロジックは
// すべてここに置く(vitest の対象)。

export type FilterOp = 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'range';

/** バックエンドの preds パラメータ(JSON 配列)の1要素。 */
export interface FilterPredicate {
  column: string;
  op: FilterOp;
  values: string[];
  negate?: boolean;
}

export type FilterColumnType =
  | 'string'
  | 'int'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'enum';

/** フィルタ可能列の定義(グリッド側が組み立てて filter-bar に渡す)。 */
export interface FilterColumn {
  /** 述語の column(物理列名または API フィールド名) */
  key: string;
  label: string;
  type: FilterColumnType;
  /** type='enum' の選択肢(value はバックエンドの許容値) */
  enumValues?: { value: string; label: string }[];
}

/** 列型ごとに選べる演算子(先頭が既定)。 */
export function opsFor(type: FilterColumnType): FilterOp[] {
  switch (type) {
    case 'string':
      return ['contains', 'eq'];
    case 'int':
    case 'decimal':
      return ['eq', 'gt', 'gte', 'lt', 'lte', 'range'];
    case 'date':
    case 'datetime':
      return ['eq', 'gte', 'lte', 'range'];
    case 'bool':
    case 'uuid':
    case 'enum':
      return ['eq'];
  }
}

/** カンマ区切りの複数値(OR)を許す演算子か。 */
export function opAllowsMultiValues(op: FilterOp): boolean {
  return op === 'eq' || op === 'contains';
}

/** 編集ポップオーバーのドラフト(値は生テキスト)。 */
export interface FilterDraft {
  op: FilterOp;
  /** 値1(eq/contains はカンマ区切りで OR。range は最小値) */
  v1: string;
  /** 範囲の最大値(op='range' のみ) */
  v2: string;
  negate: boolean;
}

/** 既定ドラフト。bool/enum は最初の候補を選択済みにする。 */
export function defaultDraft(col: FilterColumn): FilterDraft {
  const op = opsFor(col.type)[0];
  let v1 = '';
  if (col.type === 'bool') v1 = 'true';
  if (col.type === 'enum') v1 = col.enumValues?.[0]?.value ?? '';
  return { op, v1, v2: '', negate: false };
}

/** 既存述語をドラフトへ(チップクリックでの再編集用)。 */
export function draftFromPredicate(p: FilterPredicate): FilterDraft {
  if (p.op === 'range') {
    return { op: p.op, v1: p.values[0] ?? '', v2: p.values[1] ?? '', negate: !!p.negate };
  }
  return { op: p.op, v1: p.values.join(', '), v2: '', negate: !!p.negate };
}

/**
 * ドラフト→述語。不正(値なし・数値でない等)なら null。
 * eq/contains はカンマで分割して OR(空要素は除去)。
 */
export function draftToPredicate(col: FilterColumn, d: FilterDraft): FilterPredicate | null {
  let values: string[];
  if (d.op === 'range') {
    const v1 = d.v1.trim();
    const v2 = d.v2.trim();
    if (v1 === '' || v2 === '') return null;
    values = [v1, v2];
  } else if (opAllowsMultiValues(d.op) && col.type !== 'bool' && col.type !== 'enum') {
    values = d.v1.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (values.length === 0) return null;
  } else {
    const v = d.v1.trim();
    if (v === '') return null;
    values = [v];
  }
  for (const v of values) {
    if (!valueOk(col.type, v)) return null;
  }
  const out: FilterPredicate = { column: col.key, op: d.op, values };
  if (d.negate) out.negate = true;
  return out;
}

/** 型別の軽い値検証(最終検証はサーバー)。 */
export function valueOk(type: FilterColumnType, v: string): boolean {
  switch (type) {
    case 'int':
      return /^[+-]?\d+$/.test(v);
    case 'decimal':
      return v !== '' && !Number.isNaN(Number(v));
    case 'date':
    case 'datetime':
      return /^\d{4}-\d{2}-\d{2}$/.test(v);
    case 'bool':
      return v === 'true' || v === 'false';
    default:
      return v !== '';
  }
}

const OP_SYMBOL: Record<FilterOp, string> = {
  eq: '=',
  contains: ':',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  range: ':',
};

/**
 * チップの表示文字列。例:
 *   code: B-001, C-1 / val > 10 / day: 2026-07-01〜2026-07-31 / name = x(除外)
 * negate の「(除外)」の文言は呼び出し側が i18n で渡す。
 */
export function chipText(
  col: FilterColumn,
  p: FilterPredicate,
  negateSuffix: string,
): string {
  let value: string;
  if (p.op === 'range') {
    value = `${p.values[0]}〜${p.values[1]}`;
  } else if (col.type === 'enum') {
    value = p.values
      .map((v) => col.enumValues?.find((e) => e.value === v)?.label ?? v)
      .join(', ');
  } else {
    value = p.values.join(', ');
  }
  const sym = OP_SYMBOL[p.op];
  const sep = sym === ':' ? ': ' : ` ${sym} `;
  return `${col.label}${sep}${value}${p.negate ? negateSuffix : ''}`;
}

/** 述語配列をバックエンドの preds クエリパラメータ値(JSON)へ。空なら undefined。 */
export function toPredsParam(preds: FilterPredicate[]): string | undefined {
  return preds.length > 0 ? JSON.stringify(preds) : undefined;
}
