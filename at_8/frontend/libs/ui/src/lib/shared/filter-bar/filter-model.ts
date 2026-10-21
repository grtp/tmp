export type FilterOp = 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'range';
export interface FilterPredicate {
    column: string;
    op: FilterOp;
    values: string[];
    negate?: boolean;
}
export type FilterColumnType = 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'uuid' | 'enum';
export interface FilterColumn {
    key: string;
    label: string;
    type: FilterColumnType;
    enumValues?: {
        value: string;
        label: string;
    }[];
}
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
export function opAllowsMultiValues(op: FilterOp): boolean {
    return op === 'eq' || op === 'contains';
}
export interface FilterDraft {
    op: FilterOp;
    v1: string;
    v2: string;
    negate: boolean;
}
export function defaultDraft(col: FilterColumn): FilterDraft {
    const op = opsFor(col.type)[0];
    let v1 = '';
    if (col.type === 'bool')
        v1 = 'true';
    if (col.type === 'enum')
        v1 = col.enumValues?.[0]?.value ?? '';
    return { op, v1, v2: '', negate: false };
}
export function draftFromPredicate(p: FilterPredicate): FilterDraft {
    if (p.op === 'range') {
        return { op: p.op, v1: p.values[0] ?? '', v2: p.values[1] ?? '', negate: !!p.negate };
    }
    return { op: p.op, v1: p.values.join(', '), v2: '', negate: !!p.negate };
}
export function draftToPredicate(col: FilterColumn, d: FilterDraft): FilterPredicate | null {
    let values: string[];
    if (d.op === 'range') {
        const v1 = d.v1.trim();
        const v2 = d.v2.trim();
        if (v1 === '' || v2 === '')
            return null;
        values = [v1, v2];
    }
    else if (opAllowsMultiValues(d.op) && col.type !== 'bool' && col.type !== 'enum') {
        values = d.v1.split(',').map((s) => s.trim()).filter((s) => s !== '');
        if (values.length === 0)
            return null;
    }
    else {
        const v = d.v1.trim();
        if (v === '')
            return null;
        values = [v];
    }
    for (const v of values) {
        if (!valueOk(col.type, v))
            return null;
    }
    const out: FilterPredicate = { column: col.key, op: d.op, values };
    if (d.negate)
        out.negate = true;
    return out;
}
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
export function chipText(col: FilterColumn, p: FilterPredicate, negateSuffix: string): string {
    let value: string;
    if (p.op === 'range') {
        value = `${p.values[0]}〜${p.values[1]}`;
    }
    else if (col.type === 'enum') {
        value = p.values
            .map((v) => col.enumValues?.find((e) => e.value === v)?.label ?? v)
            .join(', ');
    }
    else {
        value = p.values.join(', ');
    }
    const sym = OP_SYMBOL[p.op];
    const sep = sym === ':' ? ': ' : ` ${sym} `;
    return `${col.label}${sep}${value}${p.negate ? negateSuffix : ''}`;
}
export function toPredsParam(preds: FilterPredicate[]): string | undefined {
    return preds.length > 0 ? JSON.stringify(preds) : undefined;
}
