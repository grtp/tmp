import { ComponentType } from '@angular/cdk/portal';
import { MatDialog, MatDialogConfig, MatDialogRef, } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { ConfirmData, ConfirmDialog } from '@f-tool/ui';
import { apiErrorText } from './api-errors';
export function openModal<T, D>(dialog: MatDialog, component: ComponentType<T>, data?: D, config?: MatDialogConfig<D>): MatDialogRef<T> {
    return dialog.open(component, {
        disableClose: true,
        enterAnimationDuration: '0ms',
        exitAnimationDuration: '0ms',
        ...config,
        data,
    });
}
export function confirmAsync(dialog: MatDialog, data: ConfirmData): Promise<boolean> {
    const ref = openModal(dialog, ConfirmDialog, data, {
        role: 'alertdialog',
        width: '24rem',
    });
    return new Promise((resolve) => {
        let ok = false;
        ref.componentInstance.confirmed.subscribe(() => {
            ok = true;
            ref.close();
        });
        ref.afterClosed().subscribe(() => resolve(ok));
    });
}
export function confirmThen(dialog: MatDialog, data: ConfirmData, action: () => Promise<void>): void {
    const ref = openModal(dialog, ConfirmDialog, data, {
        role: 'alertdialog',
        width: '24rem',
    });
    ref.componentInstance.confirmed.subscribe(() => {
        void (async () => {
            ref.componentRef?.setInput('busy', true);
            try {
                await action();
            }
            finally {
                ref.close();
            }
        })();
    });
}
export async function runDialogAction<T>(transloco: TranslocoService, ref: MatDialogRef<T>, fallbackKey: string, run: () => Promise<void>): Promise<void> {
    ref.componentRef?.setInput('saving', true);
    ref.componentRef?.setInput('errorMessage', null);
    try {
        await run();
    }
    catch (err) {
        ref.componentRef?.setInput('errorMessage', apiErrorText(transloco, err, fallbackKey));
    }
    finally {
        ref.componentRef?.setInput('saving', false);
    }
}
