import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal, } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';
export interface CandidateTable {
    schemaName: string;
    tableName: string;
    hasPrimaryKey: boolean;
}
export interface CandidatePreview {
    primaryKey: string[];
    hasRowVersion: boolean;
    columns: {
        name: string;
        type: string;
        nullable: boolean;
        readonly: boolean;
        required?: boolean;
    }[];
}
export type ColumnMode = 'edit' | 'readonly' | 'hidden' | 'fixed' | 'hiddenFixed';
export interface FixedColumnSpec {
    name: string;
    kind: 'literal' | 'now';
    value?: string;
    applyOn: 'insert' | 'update' | 'both';
}
interface FixedDraft {
    kind: 'literal' | 'now';
    value: string;
    applyOn: 'insert' | 'update' | 'both';
}
export interface DialogConnection {
    id: number;
    name: string;
    schemaName?: string;
}
export interface ManagedTableRegistration {
    connectionId: number | null;
    schemaName: string;
    tableName: string;
    displayName: string;
    slug: string;
    description?: string;
    readonlyColumns: string[];
    hiddenColumns: string[];
    fixedColumns: FixedColumnSpec[];
}
export interface ManagedTableEditValue {
    schemaName: string;
    tableName: string;
    connectionName?: string;
    displayName: string;
    slug: string;
    description: string;
    readonlyColumns: string[];
    hiddenColumns: string[];
    fixedColumns: FixedColumnSpec[];
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
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
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
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly connectionChanged = output<number | null>();
    readonly candidateSelected = output<{
        schemaName: string;
        tableName: string;
    }>();
    readonly confirmed = output<ManagedTableRegistration>();
    protected readonly connectionId = signal<number | null>(null);
    protected readonly schemaFilter = signal('');
    protected readonly selected = signal<CandidateTable | null>(null);
    protected readonly displayName = signal(this.data.editValue?.displayName ?? '');
    protected readonly slug = signal(this.data.editValue?.slug ?? '');
    protected readonly description = signal(this.data.editValue?.description ?? '');
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
        return true;
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
                    if (c.readonly || pk.has(c.name.toLowerCase()))
                        continue;
                    const key = c.name.toLowerCase();
                    if (v) {
                        const f = fx.get(key);
                        if (f) {
                            init[c.name] = hd.has(key) ? 'hiddenFixed' : 'fixed';
                            drafts[c.name] = {
                                kind: f.kind,
                                value: f.value ?? '',
                                applyOn: f.applyOn,
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
                : { ...d, [name]: { kind: 'literal', value: '', applyOn: 'both' } });
        }
    }
    protected fixedDraftOf(name: string): FixedDraft {
        return (this.fixedDrafts()[name] ?? {
            kind: 'literal',
            value: '',
            applyOn: 'both',
        });
    }
    protected setFixedDraft(name: string, patch: Partial<FixedDraft>): void {
        this.fixedDrafts.update((d) => ({
            ...d,
            [name]: { ...this.fixedDraftOf(name), ...patch },
        }));
    }
    protected canUseNow(type: string): boolean {
        return type === 'date' || type === 'datetime' || type === 'string';
    }
    protected connValue(): string {
        const id = this.connectionId();
        return id === null ? '' : String(id);
    }
    protected onConnChange(value: string): void {
        const id = value === '' ? null : Number(value);
        this.connectionId.set(id);
        this.selected.set(null);
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
                };
            }),
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
