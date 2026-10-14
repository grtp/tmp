import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { PwchangeAuthCount, PwchangeCandidate, PwchangeDialogConnection, PwchangeTargetDialog, PwchangeTargetDraft, PwchangeTargetRow, PwchangeTargetSubmit, PwchangeTargetsPage, PwchangeTargetsTab, PwchangeTestSubmit, ResourceAuthDialog, ResourceAuthEntryView, SubjectOption, SubjectRef, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { PwchangeApi } from '../../core/api/pwchange-api';
import { AuthService } from '../../core/auth/auth.service';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { PwchangeConnection, PwchangeTarget, PwchangeTestResult, ResourceType } from '../../core/models';
import { createReloadRunner } from '../../core/reload-action';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-pwchange-targets-container',
    styles: ':host { display: contents; } .error { margin: 0.75rem 1rem 0; padding: 0.5rem 0.625rem; background: var(--tm-danger-bg); color: var(--tm-danger); border-radius: var(--tm-radius); font-size: 0.75rem; }',
    imports: [PwchangeTargetsPage],
    templateUrl: './pwchange-targets-container.html',
})
export class PwchangeTargetsContainer {
    private api = inject(PwchangeApi);
    private admin = inject(AdminApi);
    private auth = inject(AuthService);
    private transloco = inject(TranslocoService);
    private dialog = inject(MatDialog);
    protected readonly tab = signal<PwchangeTargetsTab>('targets');
    protected readonly loading = signal(false);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly alertThreshold = signal(20);
    private readonly targets = signal<PwchangeTarget[]>([]);
    private readonly connections = signal<PwchangeConnection[]>([]);
    protected readonly authCounts = signal<Record<number, PwchangeAuthCount>>({});
    protected readonly allAuthCount = signal<PwchangeAuthCount>({ users: 0, groups: 0 });
    private readonly pwchangeActionId = signal<number | null>(null);
    protected readonly rows = computed<PwchangeTargetRow[]>(() => this.targets().map((t) => ({
        id: t.id,
        connectionName: t.connectionName,
        connectionColor: t.connectionColor,
        schemaName: t.schemaName,
        tableName: t.tableName,
        idColumn: t.idColumn,
        passwordColumn: t.passwordColumn,
        recipeSummary: `${t.recipe.algorithm} / ${t.recipe.template} / ${t.recipe.output}`,
        saltSet: t.saltSet,
        maxFailures: t.maxFailures,
        lockMinutes: t.lockMinutes,
        policySummary: `${t.policy.minLen}-${t.policy.maxLen}${t.policy.minClasses > 0 ? `, ${t.policy.minClasses}${this.transloco.translate('pwchangeTargets.classesSuffix')}` : ''}${t.policy.asciiOnly ? ', ASCII' : ''}`,
        enabled: t.enabled,
        recentFailures: t.recentFailures,
    })));
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            const [list, conns] = await Promise.all([this.api.adminListTargets(), this.api.adminConnections()]);
            this.targets.set(list.targets);
            this.alertThreshold.set(list.alertThreshold);
            this.connections.set(conns);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            if (!silent)
                this.loading.set(false);
        }
    }
    private readonly run = createReloadRunner(this.transloco, this.saving, this.errorMessage, (silent) => this.reload(silent));
    protected onTabChanged(t: PwchangeTargetsTab): void {
        this.tab.set(t);
        if (t === 'permissions')
            void this.loadAuthCounts();
    }
    protected openCreate(): void {
        this.openDialog(null);
    }
    protected openEdit(id: number): void {
        const t = this.targets().find((x) => x.id === id);
        if (t)
            this.openDialog(t);
    }
    private draftOf(t: PwchangeTarget): PwchangeTargetDraft {
        return {
            connectionId: t.connectionId,
            connectionName: t.connectionName,
            schemaName: t.schemaName,
            tableName: t.tableName,
            idColumn: t.idColumn,
            passwordColumn: t.passwordColumn,
            nameColumn: t.nameColumn ?? '',
            fixedColumns: t.fixedColumns.map((f) => ({ name: f.name, kind: f.kind, value: f.value })),
            recipe: t.recipe,
            policy: t.policy,
            maxFailures: t.maxFailures,
            lockMinutes: t.lockMinutes,
            saltSet: t.saltSet,
            saltSetAt: t.saltSetAt ? new Date(t.saltSetAt).toLocaleString() : undefined,
            saltSetBy: t.saltSetBy,
            testAccountId: t.testAccountId ?? '',
            enabled: t.enabled,
        };
    }
    private openDialog(editing: PwchangeTarget | null): void {
        const connections: PwchangeDialogConnection[] = this.connections().map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            schemaName: c.schemaName,
            enabled: c.enabled,
        }));
        const ref = openModal(this.dialog, PwchangeTargetDialog, {
            mode: editing ? 'edit' : 'create',
            value: editing ? this.draftOf(editing) : null,
            connections,
            selfEmployeeNo: this.auth.me()?.employeeNo,
        }, { width: '44rem', maxWidth: '95vw' });
        let connId: number | null = editing?.connectionId ?? null;
        const loadCandidates = async (id: number): Promise<void> => {
            ref.componentRef?.setInput('loading', true);
            ref.componentRef?.setInput('candidates', []);
            ref.componentRef?.setInput('columns', null);
            try {
                const list = await this.api.adminCandidates(id);
                ref.componentRef?.setInput('candidates', list.map((t): PwchangeCandidate => ({ schemaName: t.schemaName, tableName: t.tableName })));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
            finally {
                ref.componentRef?.setInput('loading', false);
            }
        };
        const loadColumns = async (t: PwchangeCandidate): Promise<void> => {
            if (connId === null)
                return;
            ref.componentRef?.setInput('columns', null);
            try {
                const p = await this.api.adminColumns(connId, t.schemaName, t.tableName);
                ref.componentRef?.setInput('columns', p.columns.map((c) => ({
                    name: c.name,
                    type: c.type,
                    nullable: c.nullable,
                    readonly: c.readonly,
                    sqlType: c.sqlType,
                    unsupported: c.unsupported,
                    maxLength: c.maxLength,
                })));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
        };
        ref.componentInstance.connectionChanged.subscribe((id: number) => {
            connId = id;
            ref.componentRef?.setInput('errorMessage', null);
            void loadCandidates(id);
        });
        ref.componentInstance.tableSelected.subscribe((t: PwchangeCandidate) => {
            void loadColumns(t);
        });
        ref.componentInstance.confirmed.subscribe((e: PwchangeTargetSubmit) => {
            void runDialogAction(this.transloco, ref, editing ? 'errors.saveFailed' : 'errors.registerFailed', async () => {
                const fixedColumns = e.fixedColumns.map((f) => ({ name: f.name, kind: f.kind, value: f.value, applyOn: 'update' as const }));
                if (editing) {
                    await this.api.adminUpdateTarget(editing.id, {
                        idColumn: e.idColumn,
                        passwordColumn: e.passwordColumn,
                        nameColumn: e.nameColumn,
                        fixedColumns,
                        recipe: e.recipe,
                        policy: e.policy,
                        maxFailures: e.maxFailures,
                        lockMinutes: e.lockMinutes,
                        testAccountId: e.testAccountId,
                        ...(e.salt !== undefined ? { salt: e.salt } : {}),
                    });
                }
                else {
                    await this.api.adminCreateTarget({
                        connectionId: e.connectionId,
                        schemaName: e.schemaName,
                        tableName: e.tableName,
                        idColumn: e.idColumn,
                        passwordColumn: e.passwordColumn,
                        nameColumn: e.nameColumn || undefined,
                        fixedColumns,
                        recipe: e.recipe,
                        policy: e.policy,
                        maxFailures: e.maxFailures,
                        lockMinutes: e.lockMinutes,
                        testAccountId: e.testAccountId || undefined,
                        ...(e.salt !== undefined ? { salt: e.salt } : {}),
                    });
                }
                ref.close();
                await this.reload(true);
            });
        });
        ref.componentInstance.testClicked.subscribe((e: PwchangeTestSubmit) => {
            if (!editing)
                return;
            void (async () => {
                ref.componentRef?.setInput('testing', true);
                ref.componentRef?.setInput('testResult', null);
                try {
                    const r = await this.api.adminTest(editing.id, e);
                    ref.componentRef?.setInput('testResult', formatTestResult(this.transloco, r));
                }
                catch (err) {
                    ref.componentRef?.setInput('testResult', {
                        ok: false,
                        text: apiErrorText(this.transloco, err, 'errors.testFailed'),
                    });
                }
                finally {
                    ref.componentRef?.setInput('testing', false);
                }
            })();
        });
        if (editing) {
            void loadColumns({ schemaName: editing.schemaName, tableName: editing.tableName });
        }
    }
    protected onToggled(e: {
        id: number;
        enabled: boolean;
    }): void {
        void this.run(async () => {
            await this.api.adminUpdateTarget(e.id, { enabled: e.enabled });
        }, 'errors.updateFailed');
    }
    protected askDelete(id: number): void {
        const t = this.targets().find((x) => x.id === id);
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.deletePwchangeTargetTitle'),
            message: this.transloco.translate('confirms.deletePwchangeTargetMessage', { name: t?.connectionName ?? id }),
            danger: true,
        }, () => this.run(async () => {
            await this.api.adminDeleteTarget(id);
        }, 'errors.deleteFailed'));
    }
    private async resolveActionId(): Promise<number | null> {
        const cached = this.pwchangeActionId();
        if (cached !== null)
            return cached;
        const actions = await this.admin.listActions();
        const id = actions.find((a) => a.code === 'pwchange')?.id ?? null;
        this.pwchangeActionId.set(id);
        return id;
    }
    private async loadAuthCounts(): Promise<void> {
        try {
            const actionId = await this.resolveActionId();
            const [entries, all] = await Promise.all([
                Promise.all(this.targets().map(async (t) => [t.id, countBySubject(await this.admin.listResourceAuth('pwchange_target', t.id))] as const)),
                actionId !== null ? this.admin.listResourceAuth('action', actionId) : Promise.resolve([]),
            ]);
            this.authCounts.set(Object.fromEntries(entries));
            this.allAuthCount.set(countBySubject(all));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
    }
    protected openAuthDialog(targetId: number): void {
        const t = this.targets().find((x) => x.id === targetId);
        if (!t)
            return;
        this.openResourceAuthDialog('pwchange_target', targetId, t.connectionName, (c) => this.authCounts.update((m) => ({ ...m, [targetId]: c })));
    }
    protected openAllAuthDialog(): void {
        void (async () => {
            const actionId = await this.resolveActionId();
            if (actionId === null)
                return;
            this.openResourceAuthDialog('action', actionId, this.transloco.translate('settings.allConnectionsRow'), (c) => this.allAuthCount.set(c));
        })();
    }
    private openResourceAuthDialog(type: ResourceType, id: number, title: string, onCount: (c: PwchangeAuthCount) => void): void {
        const ref = openModal(this.dialog, ResourceAuthDialog, { title, singleLevel: true }, { width: '30rem', maxWidth: '95vw' });
        const setEntries = (entries: ResourceAuthEntryView[]): void => {
            ref.componentRef?.setInput('entries', entries);
            onCount(countBySubject(entries));
        };
        const load = async (): Promise<void> => {
            ref.componentRef?.setInput('loading', true);
            try {
                const [entries, users, groups] = await Promise.all([
                    this.admin.listResourceAuth(type, id),
                    this.admin.listUsers({ limit: 1000, offset: 0 }),
                    this.admin.listGroups(),
                ]);
                setEntries(entries);
                const options: SubjectOption[] = [
                    ...users.users.map((u): SubjectOption => ({
                        subjectKind: 'user',
                        subjectId: u.objectGuid,
                        name: u.displayName,
                        username: u.username,
                    })),
                    ...groups.map((g): SubjectOption => ({
                        subjectKind: 'group',
                        subjectId: String(g.id),
                        name: g.name,
                    })),
                ];
                ref.componentRef?.setInput('subjectOptions', options);
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
            finally {
                ref.componentRef?.setInput('loading', false);
            }
        };
        const mutate = async (run: () => Promise<unknown>): Promise<void> => {
            ref.componentRef?.setInput('saving', true);
            ref.componentRef?.setInput('errorMessage', null);
            try {
                await run();
                setEntries(await this.admin.listResourceAuth(type, id));
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.updateFailed'));
            }
            finally {
                ref.componentRef?.setInput('saving', false);
            }
        };
        ref.componentInstance.addClicked.subscribe((e: SubjectRef) => {
            void mutate(() => this.admin.setResourceAuth(type, id, e.subjectKind, e.subjectId, 'rw'));
        });
        ref.componentInstance.removeClicked.subscribe((e: SubjectRef) => {
            void mutate(() => this.admin.deleteResourceAuth(type, id, e.subjectKind, e.subjectId));
        });
        void load();
    }
}
function countBySubject(entries: {
    subjectKind: string;
}[]): PwchangeAuthCount {
    let users = 0;
    let groups = 0;
    for (const e of entries) {
        if (e.subjectKind === 'group')
            groups++;
        else
            users++;
    }
    return { users, groups };
}
function formatTestResult(transloco: TranslocoService, r: PwchangeTestResult): {
    ok: boolean;
    text: string;
} {
    const ok = r.matched === 1 && r.passwordOk;
    const parts: string[] = [];
    parts.push(transloco.translate('pwchangeTargetDialog.testMatched', { n: r.matched }));
    if (r.name)
        parts.push(r.name);
    if (r.matched === 1) {
        parts.push(transloco.translate(r.passwordOk ? 'pwchangeTargetDialog.testPwOk' : 'pwchangeTargetDialog.testPwNg'));
    }
    if (r.message && transloco.getActiveLang() === 'ja')
        parts.push(r.message);
    return { ok, text: parts.join(' / ') };
}
