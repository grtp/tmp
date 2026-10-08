import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal, } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { PasswordPolicy } from '../pwchange-policy';
export type PwchangeAlgorithm = 'sha256' | 'sha1' | 'sha512' | 'md5';
export type PwchangeEncoding = 'utf8' | 'utf16le' | 'sjis';
export type PwchangeOutput = 'hex' | 'hexupper' | 'base64' | 'binary';
export interface PwchangeRecipeSpec {
    algorithm: PwchangeAlgorithm;
    template: string;
    encoding: PwchangeEncoding;
    output: PwchangeOutput;
    iterations: number;
}
export interface PwchangeFixedColumn {
    name: string;
    kind: 'literal' | 'now';
    value?: string;
}
export interface PwchangeDialogConnection {
    id: number;
    name: string;
    color?: string;
    schemaName?: string;
    enabled: boolean;
}
export interface PwchangeCandidate {
    schemaName: string;
    tableName: string;
}
export interface PwchangeDialogColumn {
    name: string;
    type: string;
    nullable: boolean;
    readonly: boolean;
    sqlType?: string;
    unsupported?: boolean;
    maxLength?: number;
}
export interface PwchangeTargetDraft {
    connectionId: number;
    connectionName: string;
    schemaName: string;
    tableName: string;
    idColumn: string;
    passwordColumn: string;
    nameColumn: string;
    fixedColumns: PwchangeFixedColumn[];
    recipe: PwchangeRecipeSpec;
    policy: PasswordPolicy;
    maxFailures: number;
    lockMinutes: number;
    saltSet: boolean;
    saltSetAt?: string;
    saltSetBy?: string;
    testAccountId: string;
    enabled: boolean;
}
export interface PwchangeTargetSubmit {
    connectionId: number;
    schemaName: string;
    tableName: string;
    idColumn: string;
    passwordColumn: string;
    nameColumn: string;
    fixedColumns: PwchangeFixedColumn[];
    recipe: PwchangeRecipeSpec;
    policy: PasswordPolicy;
    maxFailures: number;
    lockMinutes: number;
    salt?: string;
    testAccountId: string;
}
export interface PwchangeTestSubmit {
    account: 'self' | 'test';
    currentPassword: string;
}
export interface PwchangeTargetDialogData {
    mode: 'create' | 'edit';
    value: PwchangeTargetDraft | null;
    connections: PwchangeDialogConnection[];
    selfEmployeeNo?: string;
}
const DEFAULT_RECIPE: PwchangeRecipeSpec = {
    algorithm: 'sha256',
    template: '$input$salt',
    encoding: 'utf8',
    output: 'hex',
    iterations: 1,
};
const DEFAULT_POLICY: PasswordPolicy = {
    minLen: 8,
    maxLen: 64,
    minClasses: 2,
    asciiOnly: true,
    forbidSame: true,
    forbidIdentity: true,
};
const DIGEST_BYTES: Record<PwchangeAlgorithm, number> = { sha256: 32, sha1: 20, sha512: 64, md5: 16 };
export function encodedLength(r: PwchangeRecipeSpec): number {
    const n = DIGEST_BYTES[r.algorithm];
    switch (r.output) {
        case 'binary':
            return n;
        case 'base64':
            return Math.ceil(n / 3) * 4;
        default:
            return n * 2;
    }
}
export function templateError(t: string): 'noInput' | 'badToken' | null {
    let inputs = 0;
    for (let i = 0; i < t.length;) {
        if (t[i] !== '$') {
            i++;
            continue;
        }
        const rest = t.slice(i);
        if (rest.startsWith('$input')) {
            inputs++;
            i += 6;
        }
        else if (rest.startsWith('$salt')) {
            i += 5;
        }
        else if (rest.startsWith('$$')) {
            i += 2;
        }
        else {
            return 'badToken';
        }
    }
    return inputs === 1 ? null : 'noInput';
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-pwchange-target-dialog',
    host: { class: 'tm-dialog' },
    imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './pwchange-target-dialog.html',
    styleUrl: './pwchange-target-dialog.css',
})
export class PwchangeTargetDialog {
    private readonly data = inject<PwchangeTargetDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject<MatDialogRef<PwchangeTargetDialog>>(MatDialogRef);
    protected readonly mode = this.data.mode;
    protected readonly value = this.data.value;
    protected readonly connections = this.data.connections.filter((c) => c.enabled);
    protected readonly selfEmployeeNo = this.data.selfEmployeeNo;
    readonly candidates = input<PwchangeCandidate[]>([]);
    readonly columns = input<PwchangeDialogColumn[] | null>(null);
    readonly loading = input(false);
    readonly saving = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly testing = input(false);
    readonly testResult = input<{
        ok: boolean;
        text: string;
    } | null>(null);
    readonly connectionChanged = output<number>();
    readonly tableSelected = output<PwchangeCandidate>();
    readonly confirmed = output<PwchangeTargetSubmit>();
    readonly testClicked = output<PwchangeTestSubmit>();
    protected readonly connectionId = signal<number | null>(this.value?.connectionId ?? null);
    protected readonly table = signal<PwchangeCandidate | null>(this.value ? { schemaName: this.value.schemaName, tableName: this.value.tableName } : null);
    protected readonly idColumn = signal(this.value?.idColumn ?? '');
    protected readonly passwordColumn = signal(this.value?.passwordColumn ?? '');
    protected readonly nameColumn = signal(this.value?.nameColumn ?? '');
    protected readonly fixed = signal<PwchangeFixedColumn[]>(this.value?.fixedColumns ?? []);
    protected readonly algorithm = signal<PwchangeAlgorithm>(this.value?.recipe.algorithm ?? DEFAULT_RECIPE.algorithm);
    protected readonly template = signal(this.value?.recipe.template ?? DEFAULT_RECIPE.template);
    protected readonly encoding = signal<PwchangeEncoding>(this.value?.recipe.encoding ?? DEFAULT_RECIPE.encoding);
    protected readonly output = signal<PwchangeOutput>(this.value?.recipe.output ?? DEFAULT_RECIPE.output);
    protected readonly iterations = signal(this.value?.recipe.iterations ?? DEFAULT_RECIPE.iterations);
    protected readonly salt = signal('');
    protected readonly maxFailures = signal(this.value?.maxFailures ?? 5);
    protected readonly lockMinutes = signal(this.value?.lockMinutes ?? 15);
    protected readonly policy = signal<PasswordPolicy>(this.value?.policy ?? DEFAULT_POLICY);
    protected readonly testAccountId = signal(this.value?.testAccountId ?? '');
    protected readonly testAccount = signal<'self' | 'test'>(this.selfEmployeeNo ? 'self' : 'test');
    protected readonly testPassword = signal('');
    protected readonly selectedConnection = computed(() => this.connections.find((c) => c.id === this.connectionId()) ?? null);
    protected readonly columnOptions = computed(() => this.columns() ?? []);
    protected readonly passwordColumnMeta = computed(() => this.columnOptions().find((c) => c.name === this.passwordColumn()) ?? null);
    protected readonly recipe = computed<PwchangeRecipeSpec>(() => ({
        algorithm: this.algorithm(),
        template: this.template(),
        encoding: this.encoding(),
        output: this.output(),
        iterations: this.iterations(),
    }));
    protected readonly templateError = computed(() => templateError(this.template()));
    protected readonly encodedLength = computed(() => encodedLength(this.recipe()));
    protected readonly passwordIsBinary = computed(() => {
        const c = this.passwordColumnMeta();
        return !!c && (c.sqlType ?? '').includes('binary');
    });
    protected readonly outputMismatch = computed(() => {
        const c = this.passwordColumnMeta();
        if (!c)
            return null;
        if (this.passwordIsBinary() && this.output() !== 'binary')
            return 'needBinary';
        if (!this.passwordIsBinary() && this.output() === 'binary')
            return 'needText';
        return null;
    });
    protected readonly tooLong = computed(() => {
        const c = this.passwordColumnMeta();
        return !!c && !this.passwordIsBinary() && (c.maxLength ?? 0) > 0 && this.encodedLength() > (c.maxLength ?? 0);
    });
    protected readonly weakAlgorithm = computed(() => this.algorithm() === 'sha1' || this.algorithm() === 'md5');
    protected readonly canConfirm = computed(() => {
        const p = this.policy();
        const fixedOk = this.fixed().every((f) => f.name !== '' && (f.kind === 'now' || (f.value ?? '').trim() !== ''));
        return (this.connectionId() !== null &&
            this.table() !== null &&
            this.idColumn() !== '' &&
            this.passwordColumn() !== '' &&
            this.idColumn() !== this.passwordColumn() &&
            this.templateError() === null &&
            this.outputMismatch() === null &&
            !this.tooLong() &&
            this.iterations() >= 1 &&
            this.maxFailures() >= 1 &&
            this.lockMinutes() >= 1 &&
            p.minLen >= 1 &&
            p.maxLen >= p.minLen &&
            fixedOk &&
            !this.saving());
    });
    protected readonly canTest = computed(() => this.mode === 'edit' &&
        !!this.value?.saltSet &&
        this.testPassword() !== '' &&
        (this.testAccount() === 'self' ? !!this.selfEmployeeNo : this.testAccountId().trim() !== '') &&
        !this.testing());
    constructor() {
        effect(() => {
            const cols = this.columns();
            if (!cols)
                return;
            const names = new Set(cols.map((c) => c.name));
            if (!names.has(this.idColumn()))
                this.idColumn.set('');
            if (!names.has(this.passwordColumn()))
                this.passwordColumn.set('');
            if (this.nameColumn() && !names.has(this.nameColumn()))
                this.nameColumn.set('');
            this.fixed.update((list) => list.filter((f) => f.name === '' || names.has(f.name)));
        });
    }
    protected onConnChange(v: string): void {
        const id = v === '' ? null : Number(v);
        this.connectionId.set(id);
        this.table.set(null);
        if (id !== null)
            this.connectionChanged.emit(id);
    }
    protected onTableChange(v: string): void {
        const t = this.candidates().find((c) => `${c.schemaName}.${c.tableName}` === v) ?? null;
        this.table.set(t);
        if (t)
            this.tableSelected.emit(t);
    }
    protected tableKey(c: PwchangeCandidate): string {
        return `${c.schemaName}.${c.tableName}`;
    }
    protected colLabel(c: PwchangeDialogColumn): string {
        const type = c.unsupported || (c.sqlType ?? '').includes('binary') ? c.sqlType ?? c.type : c.type;
        return c.maxLength ? `${c.name} (${type}(${c.maxLength}))` : `${c.name} (${type})`;
    }
    protected addFixed(): void {
        this.fixed.update((l) => [...l, { name: '', kind: 'literal', value: '' }]);
    }
    protected setFixed(i: number, patch: Partial<PwchangeFixedColumn>): void {
        this.fixed.update((l) => l.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    }
    protected removeFixed(i: number): void {
        this.fixed.update((l) => l.filter((_, j) => j !== i));
    }
    protected canUseNow(name: string): boolean {
        const c = this.columnOptions().find((x) => x.name === name);
        return !!c && (c.type === 'date' || c.type === 'datetime' || c.type === 'string');
    }
    protected fixedCandidates(current: string): PwchangeDialogColumn[] {
        const used = new Set(this.fixed().map((f) => f.name));
        return this.columnOptions().filter((c) => !c.readonly &&
            c.name !== this.idColumn() &&
            c.name !== this.passwordColumn() &&
            (c.name === current || !used.has(c.name)));
    }
    protected setPolicy(patch: Partial<PasswordPolicy>): void {
        this.policy.update((p) => ({ ...p, ...patch }));
    }
    protected num(v: string, fallback: number): number {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : fallback;
    }
    protected confirm(): void {
        if (!this.canConfirm())
            return;
        const t = this.table()!;
        this.confirmed.emit({
            connectionId: this.connectionId()!,
            schemaName: t.schemaName,
            tableName: t.tableName,
            idColumn: this.idColumn(),
            passwordColumn: this.passwordColumn(),
            nameColumn: this.nameColumn(),
            fixedColumns: this.fixed()
                .filter((f) => f.name !== '')
                .map((f) => ({ name: f.name, kind: f.kind, value: f.kind === 'literal' ? f.value : undefined })),
            recipe: this.recipe(),
            policy: this.policy(),
            maxFailures: this.maxFailures(),
            lockMinutes: this.lockMinutes(),
            salt: this.salt() !== '' ? this.salt() : undefined,
            testAccountId: this.testAccountId().trim(),
        });
    }
    protected test(): void {
        if (!this.canTest())
            return;
        this.testClicked.emit({ account: this.testAccount(), currentPassword: this.testPassword() });
    }
    protected cancel(): void {
        if (!this.saving() && !this.testing())
            this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.cancel();
    }
}
