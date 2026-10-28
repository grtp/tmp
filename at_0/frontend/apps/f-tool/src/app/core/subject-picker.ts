import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { SubjectOption, SubjectPickDialog } from '@f-tool/ui';
import { apiErrorText } from './api-errors';
import { AdminApi } from './api/admin-api';
import { openModal } from './dialog';
export const SUBJECT_PICK_LIMIT = 200;
export interface SubjectPickerOptions {
    titleKey: string;
    name: string;
    excluded: SubjectOption[];
    excludeGroupId?: number;
    add: (s: SubjectOption) => Promise<unknown>;
    afterChange: () => Promise<void>;
}
export interface SubjectPickerHandle {
    ref: MatDialogRef<SubjectPickDialog>;
    setExcluded(list: SubjectOption[]): void;
}
export function openSubjectPicker(dialog: MatDialog, admin: AdminApi, transloco: TranslocoService, o: SubjectPickerOptions): SubjectPickerHandle {
    const ref = openModal(dialog, SubjectPickDialog, { titleKey: o.titleKey, name: o.name }, { width: '34rem', maxWidth: '95vw' });
    const set = (name: string, value: unknown): void => ref.componentRef?.setInput(name, value);
    set('excluded', o.excluded);
    set('limit', SUBJECT_PICK_LIMIT);
    void admin
        .listGroups()
        .then((groups) => set('groupOptions', groups
        .filter((g) => g.id !== o.excludeGroupId)
        .map((g): SubjectOption => ({
        subjectKind: 'group',
        subjectId: String(g.id),
        name: g.displayName,
        username: g.name,
    }))))
        .catch((err) => set('errorMessage', apiErrorText(transloco, err, 'errors.loadFailed')));
    let seq = 0;
    const searchUsers = (q: string): void => {
        const mine = ++seq;
        set('searching', true);
        set('errorMessage', null);
        void admin
            .listUsers({ limit: SUBJECT_PICK_LIMIT, offset: 0, q })
            .then((page) => {
            if (mine !== seq)
                return;
            set('userResults', page.users.map((u): SubjectOption => ({
                subjectKind: 'user',
                subjectId: u.objectGuid,
                name: u.displayName,
                username: u.username,
                department: u.department,
            })));
            set('truncated', page.total > SUBJECT_PICK_LIMIT);
        })
            .catch((err) => {
            if (mine === seq)
                set('errorMessage', apiErrorText(transloco, err, 'errors.loadFailed'));
        })
            .finally(() => {
            if (mine === seq)
                set('searching', false);
        });
    };
    ref.componentInstance.searchRequested.subscribe((q: string) => searchUsers(q));
    searchUsers('');
    ref.componentInstance.picked.subscribe((list: SubjectOption[]) => {
        void (async () => {
            set('saving', true);
            set('errorMessage', null);
            let failed: string | null = null;
            for (const s of list) {
                try {
                    await o.add(s);
                }
                catch (err) {
                    failed = `${s.name}: ${apiErrorText(transloco, err, 'errors.updateFailed')}`;
                    break;
                }
            }
            try {
                await o.afterChange();
            }
            catch (err) {
                failed ??= apiErrorText(transloco, err, 'errors.loadFailed');
            }
            set('saving', false);
            if (failed)
                set('errorMessage', failed);
            else
                ref.close();
        })();
    });
    return { ref, setExcluded: (list) => set('excluded', list) };
}
