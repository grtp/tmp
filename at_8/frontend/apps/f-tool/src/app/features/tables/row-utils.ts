import { ColumnMeta, Row, TableMeta } from '../../core/models';
export function formatCell(v: unknown, type?: ColumnMeta['type']): string | number {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? '○' : '-';
    if (type === 'datetime' && typeof v === 'string' && v.length >= 19) {
        return v.replace('T', ' ').slice(0, 19);
    }
    if (type === 'date' && typeof v === 'string' && v.length >= 10) {
        return v.slice(0, 10);
    }
    return String(v);
}
export function blankRow(meta: TableMeta | null): Row {
    const out: Row = {};
    for (const c of meta?.columns ?? []) {
        if (!c.readonly)
            out[c.name] = c.type === 'bool' ? false : null;
    }
    return out;
}
export function editableOnly(draft: Row, meta: TableMeta): Row {
    const out: Row = {};
    for (const c of meta.columns) {
        if (c.readonly)
            continue;
        out[c.name] = draft[c.name] ?? null;
    }
    return out;
}
export function diffChanges(original: Row, draft: Row, meta: TableMeta): Row {
    const out: Row = {};
    for (const c of meta.columns) {
        if (c.readonly)
            continue;
        const before = original[c.name] ?? null;
        const after = draft[c.name] ?? null;
        if (before !== after)
            out[c.name] = after;
    }
    return out;
}
export function pkOf(row: Row, meta: TableMeta): Row {
    const key: Row = {};
    for (const pk of meta.primaryKey)
        key[pk] = row[pk];
    return key;
}
export function rowVersionOf(row: Row): string | undefined {
    const v = row['$rowVersion'];
    return typeof v === 'string' ? v : undefined;
}
