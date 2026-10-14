import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { FilterPredicate, GroupAuthGrid, GroupLevelChange, SettingsAction, SettingsGroupAuth, SettingsTabDef, SettingsTabs, SettingsUser, SubjectAddCandidate, SubjectAddDialog, SubjectAddKind, SubjectAddResult, UserLevelChange, UsersGrid, } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { confirmAsync, openModal } from '../../core/dialog';
import { fnLabel } from '../../core/fn-label';
import { Action, AuthAssignment, AuthLevel, Group, UserWithAuth, } from '../../core/models';
import { formatJst } from '../../core/time';
type PermissionsTab = 'users' | 'groups';
const CANDIDATE_LIMIT = 1000;
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-users-container',
    imports: [GroupAuthGrid, SettingsTabs, UsersGrid],
    templateUrl: './settings-users-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsUsersContainer {
    private admin = inject(AdminApi);
    private dialog = inject(MatDialog);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly tabs: SettingsTabDef[] = [
        { id: 'users', icon: 'person', labelKey: 'settings.tabUsers' },
        { id: 'groups', icon: 'group', labelKey: 'settings.tabGroupPermissions' },
    ];
    protected readonly tab = signal<PermissionsTab>('users');
    protected readonly loading = signal(false);
    protected readonly total = signal(0);
    protected readonly page = signal(1);
    protected readonly pageSize = signal(50);
    protected readonly predicates = signal<FilterPredicate[]>([]);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly showUngrantedUsers = signal(false);
    protected readonly showUngrantedGroups = signal(false);
    private readonly users = signal<UserWithAuth[]>([]);
    private readonly groups = signal<Group[]>([]);
    private readonly actions = signal<Action[]>([]);
    protected readonly settingsActions = computed<SettingsAction[]>(() => {
        void this.lang();
        return this.actions().map((a) => ({
            ...a,
            name: fnLabel(this.transloco, a.code, a.name),
        }));
    });
    protected readonly settingsUsers = computed<SettingsUser[]>(() => this.users().map((u) => {
        const levels: Record<number, string> = {};
        for (const a of u.auth)
            levels[a.actionId] = a.authLevel;
        return {
            objectGuid: u.objectGuid,
            username: u.username,
            displayName: u.displayName,
            lastLoginAt: u.lastLoginAt
                ? formatJst(u.lastLoginAt).slice(0, 16)
                : undefined,
            levels,
        };
    }));
    protected readonly settingsGroups = computed<SettingsGroupAuth[]>(() => this.groups()
        .filter((g) => this.showUngrantedGroups() || g.auth.length > 0)
        .map((g) => {
        const levels: Record<number, string> = {};
        for (const a of g.auth)
            levels[a.actionId] = a.authLevel;
        return { id: g.id, name: g.name, description: g.description, levels };
    }));
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            const size = this.pageSize();
            const [page, groups, actions] = await Promise.all([
                this.admin.listUsers({
                    limit: size,
                    offset: (this.page() - 1) * size,
                    preds: this.predicates(),
                    granted: this.showUngrantedUsers() ? undefined : true,
                }),
                this.admin.listGroups(),
                this.admin.listActions(),
            ]);
            this.users.set(page.users);
            this.total.set(page.total);
            this.groups.set(groups);
            this.actions.set(actions);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            if (!silent)
                this.loading.set(false);
        }
    }
    protected onTabChanged(id: string): void {
        this.tab.set(id as PermissionsTab);
        this.errorMessage.set(null);
    }
    protected onPredicatesChanged(preds: FilterPredicate[]): void {
        this.predicates.set(preds);
        this.page.set(1);
        this.errorMessage.set(null);
        void this.reload();
    }
    protected onPageChanged(p: number): void {
        this.page.set(p);
        void this.reload();
    }
    protected onPageSizeChanged(size: number): void {
        this.pageSize.set(size);
        this.page.set(1);
        void this.reload();
    }
    protected onShowUngrantedUsersChanged(show: boolean): void {
        this.showUngrantedUsers.set(show);
        this.page.set(1);
        this.errorMessage.set(null);
        void this.reload();
    }
    protected onShowUngrantedGroupsChanged(show: boolean): void {
        this.showUngrantedGroups.set(show);
    }
    private applyLevel(auth: {
        actionId: number;
        authLevel: AuthLevel;
    }[], actionId: number, level: UserLevelChange['level']): AuthAssignment[] {
        const assignments: AuthAssignment[] = auth
            .filter((a) => a.actionId !== actionId)
            .map((a) => ({ actionId: a.actionId, authLevel: a.authLevel }));
        if (level !== '') {
            assignments.push({ actionId, authLevel: level as AuthLevel });
        }
        return assignments;
    }
    private async save(run: () => Promise<unknown>): Promise<void> {
        this.saving.set(true);
        this.errorMessage.set(null);
        try {
            await run();
            await this.reload(true);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
        }
        finally {
            this.saving.set(false);
        }
    }
    protected onUserLevelChanged(e: UserLevelChange): void {
        const u = this.users().find((x) => x.objectGuid === e.objectGuid);
        if (!u)
            return;
        const assignments = this.applyLevel(u.auth, e.actionId, e.level);
        void this.save(() => this.admin.setUserAuth(e.objectGuid, assignments));
    }
    protected onGroupLevelChanged(e: GroupLevelChange): void {
        const g = this.groups().find((x) => x.id === e.groupId);
        if (!g)
            return;
        const assignments = this.applyLevel(g.auth, e.actionId, e.level);
        void this.save(() => this.admin.setGroupAuth(e.groupId, assignments));
    }
    protected async onUserClear(objectGuid: string): Promise<void> {
        const u = this.users().find((x) => x.objectGuid === objectGuid);
        if (!u)
            return;
        const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
        const ok = await confirmAsync(this.dialog, {
            title: t('confirms.clearUserAuthTitle'),
            message: t('confirms.clearUserAuthMessage', { name: u.displayName }),
            confirmLabel: t('confirms.clearUserAuthTitle'),
            danger: true,
        });
        if (!ok)
            return;
        void this.save(() => this.admin.setUserAuth(objectGuid, []));
    }
    protected async onGroupClear(groupId: number): Promise<void> {
        const g = this.groups().find((x) => x.id === groupId);
        if (!g)
            return;
        const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
        const ok = await confirmAsync(this.dialog, {
            title: t('confirms.clearGroupAuthTitle'),
            message: t('confirms.clearGroupAuthMessage', { name: g.name }),
            confirmLabel: t('confirms.clearGroupAuthTitle'),
            danger: true,
        });
        if (!ok)
            return;
        void this.save(() => this.admin.setGroupAuth(groupId, []));
    }
    protected openAdd(kind: SubjectAddKind): void {
        const ref = openModal(this.dialog, SubjectAddDialog, { kind }, {
            width: '28rem',
            maxWidth: '95vw',
        });
        const set = (name: string, value: unknown) => ref.componentRef?.setInput(name, value);
        set('actions', this.settingsActions());
        if (kind === 'user') {
            set('loading', true);
            void this.admin
                .listUsers({ limit: CANDIDATE_LIMIT, offset: 0, granted: false })
                .then((page) => {
                const candidates: SubjectAddCandidate[] = page.users.map((u) => ({
                    id: u.objectGuid,
                    name: u.displayName,
                    sub: u.username,
                }));
                set('candidates', candidates);
            })
                .catch((err) => {
                set('errorMessage', apiErrorText(this.transloco, err, 'errors.loadFailed'));
            })
                .finally(() => set('loading', false));
        }
        else {
            const candidates: SubjectAddCandidate[] = this.groups()
                .filter((g) => g.auth.length === 0)
                .map((g) => ({ id: String(g.id), name: g.name, sub: g.description }));
            set('candidates', candidates);
        }
        ref.componentInstance.added.subscribe((r: SubjectAddResult) => {
            set('saving', true);
            set('errorMessage', null);
            const assignments: AuthAssignment[] = [{ actionId: r.actionId, authLevel: r.level }];
            const run = kind === 'user'
                ? this.admin.setUserAuth(r.id, assignments)
                : this.admin.setGroupAuth(Number(r.id), assignments);
            void run
                .then(async () => {
                ref.close();
                await this.reload(true);
            })
                .catch((err) => {
                set('errorMessage', apiErrorText(this.transloco, err, 'errors.updateFailed'));
            })
                .finally(() => set('saving', false));
        });
    }
}
