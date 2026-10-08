import { CanDeactivateFn } from '@angular/router';
export interface ConfirmsLeave {
    confirmLeave(): boolean | Promise<boolean>;
}
export const pendingChangesGuard: CanDeactivateFn<ConfirmsLeave> = (cmp) => cmp.confirmLeave();
