import { WritableSignal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { apiErrorText } from './api-errors';
export function createReloadRunner(transloco: TranslocoService, saving: WritableSignal<boolean>, errorMessage: WritableSignal<string | null>, reload: (silent: boolean) => Promise<void>): (action: () => Promise<void>, fallbackKey: string) => Promise<void> {
    return async (action, fallbackKey) => {
        saving.set(true);
        errorMessage.set(null);
        try {
            await action();
            await reload(true);
        }
        catch (err) {
            errorMessage.set(apiErrorText(transloco, err, fallbackKey));
        }
        finally {
            saving.set(false);
        }
    };
}
