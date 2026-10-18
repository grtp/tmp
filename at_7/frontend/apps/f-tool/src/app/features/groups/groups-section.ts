import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { GroupDialog, GroupDraft, GroupExportChoice, GroupExportDialog, GroupTree, GroupTreeNode, GroupTreeRoot, GroupsPage, SettingsGroup, SubjectOption, SubjectRef, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { createReloadRunner } from '../../core/reload-action';
import { buildCsv, downloadCsv } from '../../core/csv';
import { buildExportTree, buildGroupTree, effectiveUsersOf, exportPaths, exportRankRows, parentsOf, } from '../../core/group-tree';
import { Group, GroupGraph } from '../../core/models';
export type GroupsSectionTab = 'list' | 'tree';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-groups-section',
    imports: [GroupsPage, GroupTree],
    templateUrl: './groups-section.html',
    styleUrl: './groups-section.css',
})
export class GroupsSection {
    private admin = inject(AdminApi);
    private transloco = inject(TranslocoService);
    private readonly dialog = inject(MatDialog);
    readonly tab = input<GroupsSectionTab>('list');
    readonly userSelected = output<string>();
    protected readonly loading = signal(false);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    private readonly groups = signal<Group[]>([]);
    private readonly graph = signal<GroupGraph | null>(null);
    protected readonly treeRootId = signal<number | null>(null);
    protected readonly treeRoots = computed<GroupTreeRoot[]>(() => this.groups().map((g) => ({ id: g.id, name: g.displayName, groupName: g.name })));
    protected readonly treeNodes = computed<GroupTreeNode[]>(() => {
        const g = this.graph();
        return g ? buildGroupTree(g, this.treeRootId() ?? undefined) : [];
    });
    protected openTreeExport(): void {
        const ref = openModal(this.dialog, GroupExportDialog, {}, { width: '27.5rem', maxWidth: '95vw' });
        ref.componentRef?.setInput('rankAvailable', (this.graph()?.groups ?? []).some((x) => x.rank != null));
        ref.componentInstance.exported.subscribe((choice: GroupExportChoice) => {
            this.onTreeExport(choice);
            ref.close();
        });
    }
    private onTreeExport(choice: GroupExportChoice): void {
        const g = this.graph();
        if (!g)
            return;
        const tree = buildExportTree(g, this.treeRootId() ?? undefined);
        const stamp = new Date().toISOString().slice(0, 10);
        if (choice.kind === 'json') {
            downloadText(`groups-${stamp}.json`, JSON.stringify(tree, null, 2), 'application/json');
            return;
        }
        if (choice.kind === 'csvRank') {
            const rows = exportRankRows(tree);
            if (rows.length === 0)
                return;
            downloadCsv(`groups-rank-${stamp}.csv`, buildCsv(rows[0], rows.slice(1)), choice.excelCompat);
            return;
        }
        const rows = exportPaths(tree);
        if (rows.length === 0)
            return;
        downloadCsv(`groups-${stamp}.csv`, buildCsv(rows[0], rows.slice(1)), choice.excelCompat);
    }
    protected readonly settingsGroups = computed<SettingsGroup[]>(() => this.groups().map((g) => ({
        id: g.id,
        name: g.name,
        displayName: g.displayName,
        description: g.description,
        memberCount: g.memberCount,
    })));
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            const [groups, graph] = await Promise.all([this.admin.listGroups(), this.admin.getGroupGraph()]);
            this.groups.set(groups);
            this.graph.set(graph);
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
    protected openCreate(): void {
        const ref = openModal(this.dialog, GroupDialog, { mode: 'create' as const, value: null }, { width: '30rem', maxWidth: '95vw' });
        ref.componentInstance.saved.subscribe((d: GroupDraft) => {
            void runDialogAction(this.transloco, ref, 'errors.registerFailed', async () => {
                await this.admin.createGroup({
                    name: d.name,
                    displayName: d.displayName,
                    description: d.description,
                    rank: d.rank ?? undefined,
                });
                ref.close();
                await this.reload(true);
            });
        });
    }
    protected openEdit(id: number): void {
        const g = this.groups().find((x) => x.id === id);
        if (!g)
            return;
        const ref = openModal(this.dialog, GroupDialog, {
            mode: 'edit' as const,
            value: { name: g.name, displayName: g.displayName, description: g.description ?? '', rank: g.rank ?? null },
        }, { width: '30rem', maxWidth: '95vw' });
        const applyContext = (): void => {
            const g = this.graph();
            if (!g)
                return;
            ref.componentRef?.setInput('parents', parentsOf(g, id).map((p) => ({ id: p.id, name: p.displayName })));
            ref.componentRef?.setInput('effectiveUsers', effectiveUsersOf(g, id).size);
        };
        applyContext();
        const loadMembers = async (): Promise<void> => {
            const members = await this.admin.listGroupMembers(id);
            ref.componentRef?.setInput('members', members.map((m): SubjectOption => ({
                subjectKind: m.subjectKind,
                subjectId: m.subjectId,
                name: m.name,
                username: m.username ?? m.groupName,
            })));
        };
        const load = async (): Promise<void> => {
            ref.componentRef?.setInput('loadingMembers', true);
            try {
                const [users, groups] = await Promise.all([
                    this.admin.listUsers({ limit: 1000, offset: 0 }),
                    this.admin.listGroups(),
                ]);
                const options: SubjectOption[] = [
                    ...users.users.map((u): SubjectOption => ({
                        subjectKind: 'user',
                        subjectId: u.objectGuid,
                        name: u.displayName,
                        username: u.username,
                    })),
                    ...groups
                        .filter((x) => x.id !== id)
                        .map((x): SubjectOption => ({
                        subjectKind: 'group',
                        subjectId: String(x.id),
                        name: x.displayName,
                        username: x.name,
                    })),
                ];
                ref.componentRef?.setInput('subjectOptions', options);
                await loadMembers();
            }
            catch (err) {
                ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
            finally {
                ref.componentRef?.setInput('loadingMembers', false);
            }
        };
        {
            const mutate = async (run: () => Promise<unknown>): Promise<void> => {
                ref.componentRef?.setInput('saving', true);
                ref.componentRef?.setInput('errorMessage', null);
                try {
                    await run();
                    await loadMembers();
                    await this.reload(true);
                    applyContext();
                }
                catch (err) {
                    ref.componentRef?.setInput('errorMessage', apiErrorText(this.transloco, err, 'errors.updateFailed'));
                }
                finally {
                    ref.componentRef?.setInput('saving', false);
                }
            };
            ref.componentInstance.memberAdded.subscribe((s: SubjectRef) => {
                void mutate(() => this.admin.addGroupMember(id, s.subjectKind, s.subjectId));
            });
            ref.componentInstance.memberRemoved.subscribe((s: SubjectRef) => {
                void mutate(() => this.admin.removeGroupMember(id, s.subjectKind, s.subjectId));
            });
            ref.componentInstance.saved.subscribe((d: GroupDraft) => {
                void runDialogAction(this.transloco, ref, 'errors.saveFailed', async () => {
                    await this.admin.updateGroup(id, {
                        name: d.name,
                        displayName: d.displayName,
                        description: d.description,
                        rank: d.rank,
                    });
                    ref.close();
                    await this.reload(true);
                });
            });
        }
        void load();
    }
    protected askDelete(id: number): void {
        const g = this.groups().find((x) => x.id === id);
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.deleteGroupTitle'),
            message: this.transloco.translate('confirms.deleteGroupMessage', {
                name: g?.displayName ?? id,
            }),
            danger: true,
        }, () => this.run(async () => {
            await this.admin.deleteGroup(id);
        }, 'errors.deleteFailed'));
    }
}
function downloadText(filename: string, text: string, mime: string): void {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
