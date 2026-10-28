import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';
import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';
import { browserTimeZone, timeZoneChoices, timeZoneLabel } from '../../shared/timezone';
const DEFAULT_FIXED_TZ = 'Asia/Tokyo';
export interface CandidateTable {
    schemaName: string;
    tableName: string;
    hasPrimaryKey: boolean;
}
export interface CandidatePreview {
    primaryKey: string[];
    hasRowVersion: boolean;
    uniqueKeys?: string[][];
    columns: {
        name: string;
        type: string;
        nullable: boolean;
        readonly: boolean;
        required?: boolean;
        sqlType?: string;
        unsupported?: boolean;
    }[];
}
export type ColumnMode = 'edit' | 'readonly' | 'hidden' | 'fixed' | 'hiddenFixed';
export interface FixedColumnSpec {
    name: string;
    kind: 'literal' | 'now';
    value?: string;
    applyOn: 'insert' | 'update' | 'both';
    tz?: string;
}
interface FixedDraft {
    kind: 'literal' | 'now';
    value: string;
    applyOn: 'insert' | 'update' | 'both';
    tz: string;
}
export interface LookupSpec {
    columns: string[];
    refSchema: string;
    refTable: string;
    refKey: string[];
    display: string[];
    label?: string;
    displayLabels?: Record<string, string>;
}
interface LookupDraft {
    ref: string;
    refSchema: string;
    refTable: string;
    refKey: string[];
    columns: string[];
    display: string[];
    label: string;
    displayLabels: Record<string, string>;
}
export interface RefKeyChoice {
    columns: string[];
    kind: 'pk' | 'unique';
}
export function refKeyOf(schema: string, table: string): string {
    return `${schema}.${table}`.toLowerCase();
}
export interface DialogConnection {
    id: number;
    name: string;
    schemaName?: string;
    color?: string;
}
export interface ManagedTableRegistration {
    connectionId: number | null;
    schemaName: string;
    tableName: string;
    displayName: string;
    slug: string;
    description?: string;
    color?: string;
    readonlyColumns: string[];
    hiddenColumns: string[];
    fixedColumns: FixedColumnSpec[];
    lookups: LookupSpec[];
    columnOrder: string[];
}
export interface ManagedTableEditValue {
    schemaName: string;
    tableName: string;
    connectionName?: string;
    displayName: string;
    slug: string;
    description: string;
    color?: string;
    connectionColor?: string;
    readonlyColumns: string[];
    hiddenColumns: string[];
    fixedColumns: FixedColumnSpec[];
    lookups: LookupSpec[];
    columnOrder: string[];
}
export interface PreviewRow {
    key: string;
    name: string;
    type: string;
    nullable: boolean;
    col?: CandidatePreview['columns'][number];
    derived: boolean;
    lookupIndex?: number;
    refColumn?: string;
    alias?: string;
}
export interface ManagedTableDialogData {
    mode: 'create' | 'edit';
    editValue: ManagedTableEditValue | null;
    connections: DialogConnection[];
    usedSlugs: string[];
}
const AUDIT_COLUMN_RE = /^(create|created|update|updated|insert|inserted|modify|modified)_?(at|on|by|user|date|time|datetime)$/i;
const SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-managed-table-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe, TmResizeColumnsDirective],
    templateUrl: './managed-table-dialog.html',
    styleUrl: './managed-table-dialog.css',
})
export class ManagedTableDialog {
    private readonly data = inject<ManagedTableDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<ManagedTableDialog>>(MatDialogRef);
    protected readonly mode = this.data.mode;
    protected readonly editValue = this.data.editValue;
    protected readonly connections = this.data.connections;
    readonly candidates = input<CandidateTable[]>([]);
    readonly preview = input<CandidatePreview | null>(null);
    readonly refCandidates = input<CandidateTable[]>([]);
    readonly refPreviews = input<Record<string, CandidatePreview>>({});
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly connectionChanged = output<number | null>();
    readonly candidateSelected = output<{
        schemaName: string;
        tableName: string;
    }>();
    readonly refTableSelected = output<{
        schemaName: string;
        tableName: string;
    }>();
    readonly confirmed = output<ManagedTableRegistration>();
    protected readonly lookupDrafts = signal<LookupDraft[]>((this.data.editValue?.lookups ?? []).map((l) => ({
        ref: refKeyOf(l.refSchema, l.refTable),
        refSchema: l.refSchema,
        refTable: l.refTable,
        refKey: [...l.refKey],
        columns: [...l.columns],
        display: [...l.display],
        label: l.label ?? '',
        displayLabels: { ...(l.displayLabels ?? {}) },
    })));
    protected readonly connectionId = signal<number | null>(null);
    protected readonly schemaFilter = signal('');
    protected readonly selected = signal<CandidateTable | null>(null);
    protected readonly displayName = signal(this.data.editValue?.displayName ?? '');
    protected readonly slug = signal(this.data.editValue?.slug ?? '');
    protected readonly description = signal(this.data.editValue?.description ?? '');
    protected readonly color = signal(this.data.editValue?.color ?? '');
    protected readonly inheritedColor = computed(() => {
        if (this.mode === 'edit')
            return this.editValue?.connectionColor ?? '';
        const id = this.connectionId();
        if (id === null)
            return '';
        return this.connections.find((c) => c.id === id)?.color ?? '';
    });
    protected readonly slugError = computed<'invalid' | 'taken' | null>(() => {
        const s = this.slug().trim();
        if (s === '')
            return null;
        if (!SLUG_RE.test(s))
            return 'invalid';
        if (this.data.usedSlugs.includes(s.toLowerCase()))
            return 'taken';
        return null;
    });
    protected readonly colModes = signal<Record<string, ColumnMode>>({});
    protected readonly fixedDrafts = signal<Record<string, FixedDraft>>({});
    protected readonly filteredCandidates = computed(() => {
        const f = this.schemaFilter().trim().toLowerCase();
        if (!f)
            return this.candidates();
        return this.candidates().filter((t) => t.schemaName.toLowerCase().includes(f));
    });
    protected readonly lockedSchema = computed(() => {
        const id = this.connectionId();
        if (id === null)
            return undefined;
        const schema = this.connections.find((c) => c.id === id)?.schemaName;
        return schema || undefined;
    });
    protected readonly canConfirm = computed(() => {
        const named = this.displayName().trim() !== '' &&
            this.slug().trim() !== '' &&
            this.slugError() === null;
        const base = this.mode === 'edit' ? named : this.selected() !== null && named;
        if (!base)
            return false;
        const modes = this.colModes();
        const drafts = this.fixedDrafts();
        for (const name of Object.keys(modes)) {
            if (modes[name] !== 'fixed' && modes[name] !== 'hiddenFixed')
                continue;
            const d = drafts[name];
            if (!d || (d.kind === 'literal' && d.value.trim() === ''))
                return false;
        }
        for (const l of this.lookupDrafts()) {
            if (!l.ref || l.refKey.length === 0 || l.display.length === 0)
                return false;
            if (l.columns.length !== l.refKey.length || l.columns.some((c) => c === ''))
                return false;
        }
        return true;
    });
    protected readonly refTableOptions = computed(() => {
        const self = this.mode === 'edit'
            ? refKeyOf(this.editValue?.schemaName ?? '', this.editValue?.tableName ?? '')
            : this.selected()
                ? refKeyOf(this.selected()!.schemaName, this.selected()!.tableName)
                : '';
        return this.refCandidates().filter((t) => refKeyOf(t.schemaName, t.tableName) !== self);
    });
    protected refPreviewOf(ref: string): CandidatePreview | undefined {
        return this.refPreviews()[ref];
    }
    protected refKeyChoices(ref: string): RefKeyChoice[] {
        const p = this.refPreviewOf(ref);
        if (!p)
            return [];
        const out: RefKeyChoice[] = [];
        if (p.primaryKey.length > 0)
            out.push({ columns: p.primaryKey, kind: 'pk' });
        for (const uk of p.uniqueKeys ?? [])
            out.push({ columns: uk, kind: 'unique' });
        return out;
    }
    protected keyValue(cols: string[]): string {
        return cols.join(',');
    }
    protected keyColumnOptions(ref: string, refCol: string): string[] {
        const p = this.preview();
        const rp = this.refPreviewOf(ref);
        if (!p)
            return [];
        const type = rp?.columns.find((c) => c.name === refCol)?.type;
        return p.columns
            .filter((c) => {
            const m = this.modeOf(c.name);
            if (m === 'hidden' || m === 'hiddenFixed')
                return false;
            return !type || c.type === type;
        })
            .map((c) => c.name);
    }
    protected displayOptions(ref: string): string[] {
        return (this.refPreviewOf(ref)?.columns ?? [])
            .filter((c) => !c.unsupported)
            .map((c) => c.name);
    }
    protected addLookup(): void {
        this.lookupDrafts.update((ds) => [
            ...ds,
            { ref: '', refSchema: '', refTable: '', refKey: [], columns: [], display: [], label: '', displayLabels: {} },
        ]);
    }
    protected removeLookup(i: number): void {
        this.lookupDrafts.update((ds) => ds.filter((_, j) => j !== i));
    }
    private patchLookup(i: number, patch: Partial<LookupDraft>): void {
        this.lookupDrafts.update((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    }
    protected setLookupRef(i: number, value: string): void {
        const t = this.refTableOptions().find((c) => refKeyOf(c.schemaName, c.tableName) === value);
        if (!t) {
            this.patchLookup(i, { ref: '', refSchema: '', refTable: '', refKey: [], columns: [], display: [] });
            return;
        }
        this.patchLookup(i, {
            ref: value,
            refSchema: t.schemaName,
            refTable: t.tableName,
            refKey: [],
            columns: [],
            display: [],
        });
        if (!this.refPreviewOf(value)) {
            this.refTableSelected.emit({ schemaName: t.schemaName, tableName: t.tableName });
        }
    }
    protected setLookupKey(i: number, value: string): void {
        const choice = this.refKeyChoices(this.lookupDrafts()[i].ref).find((k) => this.keyValue(k.columns) === value);
        const refKey = choice ? [...choice.columns] : [];
        this.patchLookup(i, { refKey, columns: refKey.map(() => '') });
    }
    protected setLookupColumn(i: number, k: number, value: string): void {
        const cols = [...this.lookupDrafts()[i].columns];
        cols[k] = value;
        this.patchLookup(i, { columns: cols });
    }
    protected toggleDisplay(i: number, col: string, on: boolean): void {
        const d = this.lookupDrafts()[i];
        const display = on
            ? d.display.includes(col)
                ? d.display
                : [...d.display, col]
            : d.display.filter((c) => c !== col);
        this.patchLookup(i, { display });
    }
    protected setDisplayLabel(i: number, col: string, value: string): void {
        this.lookupDrafts.update((ds) => ds.map((d, j) => (j === i ? { ...d, displayLabels: { ...d.displayLabels, [col]: value } } : d)));
    }
    protected setLookupLabel(i: number, value: string): void {
        this.patchLookup(i, { label: value });
    }
    protected readonly colOrder = signal<string[]>([
        ...(this.data.editValue?.columnOrder ?? []),
    ]);
    private readonly derivedRows = computed<PreviewRow[]>(() => {
        const out: PreviewRow[] = [];
        this.lookupDrafts().forEach((l, i) => {
            const rp = this.refPreviewOf(l.ref);
            const label = l.label.trim() || l.refTable;
            for (const d of l.display) {
                const c = rp?.columns.find((x) => x.name === d);
                out.push({
                    key: `lk${i}.${d}`,
                    name: `${label}.${d}`,
                    type: c?.type ?? '',
                    nullable: true,
                    derived: true,
                    lookupIndex: i,
                    refColumn: d,
                    alias: l.displayLabels[d] ?? '',
                });
            }
        });
        return out;
    });
    protected readonly previewRows = computed<PreviewRow[]>(() => {
        const p = this.preview();
        if (!p)
            return [];
        const base: PreviewRow[] = p.columns.map((c) => ({
            key: c.name,
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            col: c,
            derived: false,
        }));
        const all = [...base, ...this.derivedRows()];
        const pos = new Map<string, number>();
        this.colOrder().forEach((k, i) => {
            if (!pos.has(k))
                pos.set(k, i);
        });
        const placed: PreviewRow[] = [];
        const rest: PreviewRow[] = [];
        for (const r of all) {
            if (pos.has(r.key))
                placed.push(r);
            else
                rest.push(r);
        }
        placed.sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
        return [...placed, ...rest];
    });
    protected moveRow(key: string, delta: -1 | 1): void {
        const keys = this.previewRows().map((r) => r.key);
        const i = keys.indexOf(key);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= keys.length)
            return;
        [keys[i], keys[j]] = [keys[j], keys[i]];
        this.colOrder.set(keys);
    }
    protected resetOrder(): void {
        this.colOrder.set([]);
    }
    protected readonly orderCustomized = computed(() => {
        const p = this.preview();
        if (!p || this.colOrder().length === 0)
            return false;
        const def = [...p.columns.map((c) => c.name), ...this.derivedRows().map((r) => r.key)];
        const cur = this.previewRows().map((r) => r.key);
        return def.join('\0') !== cur.join('\0');
    });
    protected readonly hiddenRequiredCols = computed(() => {
        const p = this.preview();
        if (!p)
            return [];
        const modes = this.colModes();
        const drafts = this.fixedDrafts();
        return p.columns
            .filter((c) => {
            if (!c.required)
                return false;
            const m = modes[c.name];
            if (m === 'hidden')
                return true;
            return m === 'hiddenFixed' && drafts[c.name]?.applyOn === 'update';
        })
            .map((c) => c.name);
    });
    constructor() {
        effect(() => {
            const p = this.preview();
            const init: Record<string, ColumnMode> = {};
            const drafts: Record<string, FixedDraft> = {};
            if (p) {
                const pk = new Set(p.primaryKey.map((n) => n.toLowerCase()));
                const v = this.mode === 'edit' ? this.editValue : null;
                const ro = new Set((v?.readonlyColumns ?? []).map((n) => n.toLowerCase()));
                const hd = new Set((v?.hiddenColumns ?? []).map((n) => n.toLowerCase()));
                const fx = new Map((v?.fixedColumns ?? []).map((f) => [f.name.toLowerCase(), f] as const));
                for (const c of p.columns) {
                    const key = c.name.toLowerCase();
                    if (pk.has(key))
                        continue;
                    if (c.readonly) {
                        init[c.name] = v ? (hd.has(key) ? 'hidden' : 'edit') : c.unsupported ? 'hidden' : 'edit';
                        continue;
                    }
                    if (v) {
                        const f = fx.get(key);
                        if (f) {
                            init[c.name] = hd.has(key) ? 'hiddenFixed' : 'fixed';
                            drafts[c.name] = {
                                kind: f.kind,
                                value: f.value ?? '',
                                applyOn: f.applyOn,
                                tz: f.tz || DEFAULT_FIXED_TZ,
                            };
                        }
                        else {
                            init[c.name] = hd.has(key)
                                ? 'hidden'
                                : ro.has(key)
                                    ? 'readonly'
                                    : 'edit';
                        }
                    }
                    else {
                        init[c.name] = AUDIT_COLUMN_RE.test(c.name) ? 'readonly' : 'edit';
                    }
                }
            }
            this.colModes.set(init);
            this.fixedDrafts.set(drafts);
        });
    }
    protected isPk(name: string): boolean {
        const p = this.preview();
        return (!!p && p.primaryKey.some((n) => n.toLowerCase() === name.toLowerCase()));
    }
    protected modeOf(name: string): ColumnMode {
        return this.colModes()[name] ?? 'edit';
    }
    protected setMode(name: string, mode: string): void {
        this.colModes.update((m) => ({ ...m, [name]: mode as ColumnMode }));
        if (mode === 'fixed' || mode === 'hiddenFixed') {
            this.fixedDrafts.update((d) => d[name]
                ? d
                : { ...d, [name]: { kind: 'literal', value: '', applyOn: 'both', tz: DEFAULT_FIXED_TZ } });
        }
    }
    protected fixedDraftOf(name: string): FixedDraft {
        return (this.fixedDrafts()[name] ?? {
            kind: 'literal',
            value: '',
            applyOn: 'both',
            tz: DEFAULT_FIXED_TZ,
        });
    }
    protected setFixedDraft(name: string, patch: Partial<FixedDraft>): void {
        this.fixedDrafts.update((d) => ({
            ...d,
            [name]: { ...this.fixedDraftOf(name), ...patch },
        }));
    }
    protected readonly fixedTzChoices = computed(() => timeZoneChoices(browserTimeZone(), ...Object.values(this.fixedDrafts()).map((d) => d.tz)));
    protected tzLabel(tz: string): string {
        return timeZoneLabel(tz);
    }
    protected canUseNow(type: string): boolean {
        return type === 'date' || type === 'datetime' || type === 'string';
    }
    protected appliesOn(name: string, when: 'insert' | 'update'): boolean {
        const a = this.fixedDraftOf(name).applyOn;
        return a === 'both' || a === when;
    }
    protected toggleApply(name: string, when: 'insert' | 'update', input: HTMLInputElement): void {
        const on = input.checked;
        const insert = when === 'insert' ? on : this.appliesOn(name, 'insert');
        const update = when === 'update' ? on : this.appliesOn(name, 'update');
        if (!insert && !update) {
            input.checked = true;
            return;
        }
        this.setFixedDraft(name, { applyOn: insert && update ? 'both' : insert ? 'insert' : 'update' });
    }
    protected connValue(): string {
        const id = this.connectionId();
        return id === null ? '' : String(id);
    }
    protected onConnChange(value: string): void {
        const id = value === '' ? null : Number(value);
        this.connectionId.set(id);
        this.selected.set(null);
        this.lookupDrafts.set([]);
        const schema = id === null
            ? undefined
            : this.connections.find((c) => c.id === id)?.schemaName;
        this.schemaFilter.set(schema || '');
        this.connectionChanged.emit(id);
    }
    protected isSelected(t: CandidateTable): boolean {
        const s = this.selected();
        return (s !== null && s.schemaName === t.schemaName && s.tableName === t.tableName);
    }
    protected select(t: CandidateTable): void {
        this.selected.set(t);
        if (this.displayName().trim() === '') {
            this.displayName.set(t.tableName);
        }
        if (this.slug().trim() === '') {
            this.slug.set(t.tableName);
        }
        this.candidateSelected.emit({
            schemaName: t.schemaName,
            tableName: t.tableName,
        });
    }
    protected confirm(): void {
        const v = this.mode === 'edit' ? this.editValue : null;
        const s = this.selected();
        const target = v ?? s;
        if (!target)
            return;
        const modes = this.colModes();
        const names = Object.keys(modes);
        this.confirmed.emit({
            connectionId: this.connectionId(),
            schemaName: target.schemaName,
            tableName: target.tableName,
            displayName: this.displayName().trim(),
            slug: this.slug().trim(),
            description: this.description().trim() || undefined,
            color: this.color() || undefined,
            readonlyColumns: names.filter((n) => modes[n] === 'readonly'),
            hiddenColumns: names.filter((n) => modes[n] === 'hidden' || modes[n] === 'hiddenFixed'),
            fixedColumns: names
                .filter((n) => modes[n] === 'fixed' || modes[n] === 'hiddenFixed')
                .map((n) => {
                const d = this.fixedDraftOf(n);
                return {
                    name: n,
                    kind: d.kind,
                    value: d.kind === 'literal' ? d.value : undefined,
                    applyOn: d.applyOn,
                    tz: d.kind === 'now' ? d.tz : undefined,
                };
            }),
            lookups: this.lookupDrafts().map((l) => {
                const labels: Record<string, string> = {};
                for (const d of l.display) {
                    const v = (l.displayLabels[d] ?? '').trim();
                    if (v)
                        labels[d] = v;
                }
                return {
                    columns: l.columns,
                    refSchema: l.refSchema,
                    refTable: l.refTable,
                    refKey: l.refKey,
                    display: l.display,
                    label: l.label.trim() || undefined,
                    displayLabels: Object.keys(labels).length > 0 ? labels : undefined,
                };
            }),
            columnOrder: this.orderCustomized()
                ? this.previewRows()
                    .filter((r) => {
                    const m = modes[r.key];
                    return m !== 'hidden' && m !== 'hiddenFixed';
                })
                    .map((r) => r.key)
                : [],
        });
    }
    protected cancel(): void {
        if (!this.saving()) {
            this.dialogRef.close();
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
