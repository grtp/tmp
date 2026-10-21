import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { DirectoryAddDialog, DirectoryCandidate, FilterPredicate, LedgerUser, SettingsTabDef, SettingsTabs, UserDetail, UserDetailDialog, UserDetailGroup, UserLedger, formatInZone, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { confirmThen, openModal } from '../../core/dialog';
import { UserWithAuth } from '../../core/models';
import { UserSettingsService } from '../../core/user-settings.service';
import { GroupsSection } from '../groups/groups-section';
type GroupsTab = 'ledger' | 'list' | 'tree';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-groups-container',
    imports: [GroupsSection, SettingsTabs, UserLedger],
    templateUrl: './settings-groups-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsGroupsContainer {
    private admin = inject(AdminApi);
    private transloco = inject(TranslocoService);
    private userSettings = inject(UserSettingsService);
    private readonly dialog = inject(MatDialog);
    protected readonly tabs: SettingsTabDef[] = [
        { id: 'ledger', icon: 'person', labelKey: 'settings.tabUserLedger' },
        { id: 'list', icon: 'folder_shared', labelKey: 'settings.tabGroupList' },
        { id: 'tree', icon: 'account_tree', labelKey: 'settings.tabGroupTree' },
    ];
    protected readonly tab = signal<GroupsTab>('ledger');
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly ledgerLoading = signal(false);
    protected readonly total = signal(0);
    protected readonly page = signal(1);
    protected readonly pageSize = signal(50);
    protected readonly predicates = signal<FilterPredicate[]>([]);
    private readonly users = signal<UserWithAuth[]>([]);
    protected readonly ledgerUsers = computed<LedgerUser[]>(() => this.users().map((u) => ({
        objectGuid: u.objectGuid,
        username: u.username,
        displayName: u.displayName,
        employeeNo: u.employeeNo,
        department: u.department,
        title: u.title,
        email: u.email,
        lastLoginAt: u.lastLoginAt
            ? formatInZone(u.lastLoginAt, this.userSettings.effectiveTz()).slice(0, 16)
            : undefined,
    })));
    constructor() {
        void this.reloadLedger();
    }
    protected onTabChanged(id: string): void {
        const tab: GroupsTab = id === 'list' || id === 'tree' ? id : 'ledger';
        this.tab.set(tab);
        this.errorMessage.set(null);
        if (tab === 'ledger')
            void this.reloadLedger();
    }
    private async reloadLedger(): Promise<void> {
        this.ledgerLoading.set(true);
        try {
            const size = this.pageSize();
            const page = await this.admin.listUsers({
                limit: size,
                offset: (this.page() - 1) * size,
                preds: this.predicates(),
                tz: this.userSettings.effectiveTz(),
            });
            this.users.set(page.users);
            this.total.set(page.total);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            this.ledgerLoading.set(false);
        }
    }
    protected onPredicatesChanged(preds: FilterPredicate[]): void {
        this.predicates.set(preds);
        this.page.set(1);
        this.errorMessage.set(null);
        void this.reloadLedger();
    }
    protected onPageChanged(p: number): void {
        this.page.set(p);
        void this.reloadLedger();
    }
    protected onPageSizeChanged(size: number): void {
        this.pageSize.set(size);
        this.page.set(1);
        void this.reloadLedger();
    }
    protected openAddFromAd(): void {
        const ref = openModal(this.dialog, DirectoryAddDialog, {}, { width: '34rem', maxWidth: '95vw' });
        const set = (name: string, value: unknown) => ref.componentRef?.setInput(name, value);
        ref.componentInstance.searchRequested.subscribe((q: string) => {
            set('searching', true);
            set('errorMessage', null);
            void this.admin
                .searchDirectoryUsers(q)
                .then((page) => {
                set('limit', page.limit);
                set('truncated', page.truncated);
                const results: DirectoryCandidate[] = page.users.map((u) => ({
                    objectGuid: u.objectGuid,
                    username: u.username,
                    displayName: u.displayName,
                    department: u.department,
                    employeeNo: u.employeeNo,
                    registered: u.registered,
                }));
                set('results', results);
            })
                .catch((err) => set('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed')))
                .finally(() => set('searching', false));
        });
        ref.componentInstance.addRequested.subscribe((c: DirectoryCandidate) => {
            set('saving', true);
            set('errorMessage', null);
            void this.admin
                .registerUser({ username: c.username, objectGuid: c.objectGuid })
                .then(async () => {
                ref.close();
                await this.reloadLedger();
            })
                .catch((err) => set('errorMessage', apiErrorText(this.transloco, err, 'errors.registerFailed')))
                .finally(() => set('saving', false));
        });
    }
    protected openUserDetail(objectGuid: string): void {
        void (async () => {
            try {
                const [u, graph] = await Promise.all([this.admin.getUser(objectGuid), this.admin.getGroupGraph()]);
                const user: UserDetail = {
                    objectGuid: u.objectGuid,
                    username: u.username,
                    displayName: u.displayName,
                    employeeNo: u.employeeNo,
                    department: u.department,
                    title: u.title,
                    email: u.email,
                    lastLoginAt: u.lastLoginAt ? formatInZone(u.lastLoginAt, this.userSettings.effectiveTz()) : undefined,
                };
                const byId = new Map(graph.groups.map((g) => [g.id, g]));
                const groups: UserDetailGroup[] = graph.edges
                    .filter((e) => e.subjectKind === 'user' && e.subjectId === objectGuid)
                    .map((e) => byId.get(e.groupId))
                    .filter((g): g is NonNullable<typeof g> => !!g)
                    .map((g) => ({ id: g.id, name: g.displayName, groupName: g.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                const ref = openModal(this.dialog, UserDetailDialog, { user }, { width: '30rem', maxWidth: '95vw' });
                ref.componentRef?.setInput('groups', groups);
            }
            catch (err) {
                this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
            }
        })();
    }
    protected askDeleteUser(objectGuid: string): void {
        const u = this.users().find((x) => x.objectGuid === objectGuid);
        if (!u)
            return;
        confirmThen(this.dialog, {
            title: this.transloco.translate('confirms.deleteUserTitle'),
            message: this.transloco.translate('confirms.deleteUserMessage', { name: u.displayName, username: u.username }),
            confirmLabel: this.transloco.translate('confirms.deleteUserTitle'),
            danger: true,
        }, () => {
            this.errorMessage.set(null);
            return this.admin
                .deleteUser(objectGuid)
                .then(() => this.reloadLedger())
                .catch((err) => this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.deleteFailed')));
        });
    }
}
