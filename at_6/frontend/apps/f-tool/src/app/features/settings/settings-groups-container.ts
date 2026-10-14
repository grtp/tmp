import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { GroupDialog, GroupDraft, GroupsPage, SettingsGroup, SubjectOption, SubjectRef, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { confirmThen, openModal, runDialogAction } from '../../core/dialog';
import { createReloadRunner } from '../../core/reload-action';
import { Group } from '../../core/models';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-groups-container',
    imports: [GroupsPage],
    templateUrl: './settings-groups-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsGroupsContainer {
    private admin = inject(AdminApi);
    private transloco = inject(TranslocoService);
    private readonly dialog = inject(MatDialog);
    protected readonly loading = signal(false);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    private readonly groups = signal<Group[]>([]);
    protected readonly settingsGroups = computed<SettingsGroup[]>(() => this.groups().map((g) => ({
        id: g.id,
        name: g.name,
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
            this.groups.set(await this.admin.listGroups());
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
                await this.admin.createGroup({ name: d.name, description: d.description });
                ref.close();
                await this.reload(true);
            });
        });
    }
    protected openEdit(id: number): void {
        const g = this.groups().find((x) => x.id === id);
        if (!g)
            return;
        const ref = openModal(this.dialog, GroupDialog, { mode: 'edit' as const, value: { name: g.name, description: g.description ?? '' } }, { width: '30rem', maxWidth: '95vw' });
        const loadMembers = async (): Promise<void> => {
            const members = await this.admin.listGroupMembers(id);
            ref.componentRef?.setInput('members', members.map((m): SubjectOption => ({
                subjectKind: m.subjectKind,
                subjectId: m.subjectId,
                name: m.name,
                username: m.username,
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
                        name: x.name,
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
        const mutate = async (run: () => Promise<unknown>): Promise<void> => {
            ref.componentRef?.setInput('saving', true);
            ref.componentRef?.setInput('errorMessage', null);
            try {
                await run();
                await loadMembers();
                await this.reload(true);
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
                await this.admin.updateGroup(id, { name: d.name, description: d.description });
                ref.close();
                await this.reload(true);
            });
        });
        void load();
    }
    protected askDelete(id: number): void {
        const g = this.groups().find((x) => x.id === id);
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.deleteGroupTitle'),
            message: this.transloco.translate('confirms.deleteGroupMessage', {
                name: g?.name ?? id,
            }),
            danger: true,
        }, () => this.run(async () => {
            await this.admin.deleteGroup(id);
        }, 'errors.deleteFailed'));
    }
}
