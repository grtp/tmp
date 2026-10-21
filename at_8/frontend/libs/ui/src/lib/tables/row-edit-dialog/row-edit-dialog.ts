import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
export interface EditColumn {
    name: string;
    type: 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'uuid';
    nullable: boolean;
    readonly: boolean;
    required?: boolean;
    maxLength?: number;
    primaryKey?: boolean;
    fixed?: boolean;
    derived?: boolean;
    label?: string;
    lookupIndex?: number;
}
export interface EditLookup {
    index: number;
    label: string;
    columns: string[];
    refKey: string[];
    display: string[];
}
export type EditValue = Record<string, unknown>;
export interface RowEditDialogData {
    mode: 'create' | 'edit';
    columns: EditColumn[];
    value: EditValue;
    canDelete: boolean;
    lookups?: EditLookup[];
}
export interface LookupKeyChange {
    index: number;
    key: unknown[];
}
export interface RowEditResult {
    mode: 'create' | 'edit';
    value: EditValue;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-row-edit-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './row-edit-dialog.html',
    styleUrl: './row-edit-dialog.css',
})
export class RowEditDialog {
    private readonly data = inject<RowEditDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<RowEditDialog>>(MatDialogRef);
    protected readonly mode = signal<'create' | 'edit'>(this.data.mode);
    protected readonly columns = this.data.columns;
    protected readonly canDelete = this.data.canDelete;
    protected readonly lookups: EditLookup[] = this.data.lookups ?? [];
    readonly errorMessage = input<string | null>(null);
    readonly saving = input(false);
    readonly saved = output<RowEditResult>();
    readonly deleteClicked = output<void>();
    readonly lookupPickRequested = output<number>();
    readonly lookupKeyChanged = output<LookupKeyChange>();
    protected readonly draft = signal<EditValue>({ ...this.data.value });
    protected pickersFor(c: EditColumn): EditLookup[] {
        return this.lookups.filter((l) => l.columns[0] === c.name);
    }
    private lookupsUsing(name: string): EditLookup[] {
        return this.lookups.filter((l) => l.columns.includes(name));
    }
    applyLookup(index: number, option: Record<string, unknown> | null): void {
        const l = this.lookups.find((x) => x.index === index);
        if (!l)
            return;
        this.draft.update((d) => {
            const next = { ...d };
            if (option) {
                l.columns.forEach((c, i) => {
                    next[c] = option[l.refKey[i]] ?? null;
                });
            }
            for (const col of l.display) {
                next[`lk${l.index}.${col}`] = option ? (option[col] ?? null) : null;
            }
            return next;
        });
    }
    protected labelOf(c: EditColumn): string {
        return c.label ?? c.name;
    }
    protected readonly canSave = computed(() => {
        for (const c of this.columns) {
            if (!c.required || c.readonly || c.fixed)
                continue;
            const v = this.draft()[c.name];
            if (v === null || v === undefined || v === '')
                return false;
        }
        return true;
    });
    protected isLocked(c: EditColumn): boolean {
        return (c.readonly || !!c.fixed || (!!c.primaryKey && this.mode() === 'edit'));
    }
    protected set(name: string, v: unknown): void {
        this.draft.update((d) => ({ ...d, [name]: v }));
        for (const l of this.lookupsUsing(name)) {
            const d = this.draft();
            this.lookupKeyChanged.emit({ index: l.index, key: l.columns.map((c) => d[c]) });
        }
    }
    protected setText(name: string, v: string): void {
        this.set(name, v === '' ? null : v);
    }
    protected setNumber(name: string, v: string): void {
        this.set(name, v === '' ? null : Number(v));
    }
    protected save(): void {
        this.saved.emit({ mode: this.mode(), value: this.draft() });
    }
    protected duplicate(): void {
        this.draft.update((d) => {
            const copy: EditValue = { ...d };
            delete copy['$rowVersion'];
            for (const c of this.columns) {
                if (c.primaryKey)
                    copy[c.name] = null;
            }
            return copy;
        });
        this.mode.set('create');
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
    protected asText(v: unknown): string {
        return v === null || v === undefined ? '' : String(v);
    }
    protected asBool(v: unknown): boolean {
        return v === true;
    }
    protected asDate(v: unknown): string {
        const s = this.asText(v);
        return s.length >= 10 ? s.slice(0, 10) : s;
    }
    protected asDateTime(v: unknown): string {
        const s = this.asText(v);
        return s.length >= 16 ? s.slice(0, 16) : s;
    }
}
