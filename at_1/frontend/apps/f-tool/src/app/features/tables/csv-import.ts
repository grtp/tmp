import { ColumnMeta, Row, TableMeta } from '../../core/models';
export interface CsvImportRow {
    display: Record<string, string>;
    parsed: Row;
    conflict: boolean;
    typeError?: string;
}
export type CsvValidation = {
    ok: true;
    rows: CsvImportRow[];
} | {
    ok: false;
    error: string;
};
export const CSV_IMPORT_MAX_ROWS = 10000;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function validateCsvRecords(records: string[][], meta: TableMeta, labels: {
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
}): CsvValidation {
    if (records.length < 2) {
        return { ok: false, error: labels.empty };
    }
    const [header, ...body] = records;
    if (body.length > CSV_IMPORT_MAX_ROWS) {
        return { ok: false, error: labels.tooManyRows };
    }
    const byName = new Map(meta.columns.map((c) => [c.name, c]));
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
        if (!c.readonly && c.required && !headerSet.has(c.name)) {
            return { ok: false, error: labels.missingColumn(c.name) };
        }
    }
    const rows: CsvImportRow[] = [];
    for (let li = 0; li < body.length; li++) {
        const rec = body[li];
        if (rec.length !== header.length) {
            return { ok: false, error: labels.columnCount(li + 2) };
        }
        const display: Record<string, string> = {};
        const parsed: Row = {};
        let typeError: string | undefined;
        for (let ci = 0; ci < header.length; ci++) {
            const col = headerCols[ci];
            const cell = rec[ci];
            display[col.name] = cell;
            if (col.readonly)
                continue;
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
export function markConflicts(rows: CsvImportRow[], meta: TableMeta, fetched: Row[]): number {
    const pk = meta.primaryKey;
    if (pk.length === 0 || fetched.length === 0)
        return 0;
    const byName = new Map(meta.columns.map((c) => [c.name, c]));
    if (pk.some((k) => byName.get(k)?.readonly))
        return 0;
    const keys = new Set(fetched.map((r) => pk.map((k) => keyPart(r[k])).join('\0')));
    let n = 0;
    for (const row of rows) {
        const key = pk.map((k) => keyPart(row.display[k])).join('\0');
        row.conflict = keys.has(key);
        if (row.conflict)
            n++;
    }
    return n;
}
function keyPart(v: unknown): string {
    if (v === null || v === undefined)
        return '';
    return String(v).trim().toLowerCase();
}
type CellResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    err: string;
};
const ok = (value: unknown): CellResult => ({ ok: true, value });
const ng = (err: string): CellResult => ({ ok: false, err });
function parseCell(col: ColumnMeta, cell: string, labels: {
    required: string;
    typeInt: string;
    typeDecimal: string;
    typeBool: string;
    typeDate: string;
    typeUuid: string;
}): CellResult {
    const s = cell.trim();
    if (s === '') {
        if (col.required)
            return ng(labels.required);
        return ok(null);
    }
    switch (col.type) {
        case 'int': {
            if (!/^[+-]?\d+$/.test(s))
                return ng(labels.typeInt);
            return ok(Number(s));
        }
        case 'decimal': {
            const f = Number(s);
            if (!isFinite(f))
                return ng(labels.typeDecimal);
            return ok(f);
        }
        case 'bool': {
            const lo = s.toLowerCase();
            if (lo === 'true' || lo === '1')
                return ok(true);
            if (lo === 'false' || lo === '0')
                return ok(false);
            return ng(labels.typeBool);
        }
        case 'date':
        case 'datetime': {
            if (isNaN(Date.parse(s)))
                return ng(labels.typeDate);
            return ok(s);
        }
        case 'uuid': {
            if (!UUID_RE.test(s))
                return ng(labels.typeUuid);
            return ok(s);
        }
        default:
            return ok(cell);
    }
}
