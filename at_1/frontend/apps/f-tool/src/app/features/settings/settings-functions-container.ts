import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { SettingsAction, SettingsPage, SettingsTab } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { fnLabel } from '../../core/fn-label';
import { Action } from '../../core/models';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-functions-container',
    imports: [SettingsPage],
    templateUrl: './settings-functions-container.html',
    styleUrl: './settings-section.css',
})
export class SettingsFunctionsContainer {
    private admin = inject(AdminApi);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly visibleTabs = signal<SettingsTab[]>(['actions']);
    protected readonly tab = signal<SettingsTab>('actions');
    protected readonly loading = signal(false);
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    private readonly actions = signal<Action[]>([]);
    protected readonly settingsActions = computed<SettingsAction[]>(() => {
        void this.lang();
        return this.actions().map((a) => ({
            ...a,
            name: fnLabel(this.transloco, a.code, a.name),
        }));
    });
    constructor() {
        void this.reload();
    }
    private async reload(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            this.actions.set(await this.admin.listActions());
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            if (!silent)
                this.loading.set(false);
        }
    }
    protected onActionToggled(e: {
        id: number;
        enabled: boolean;
    }): void {
        void (async () => {
            this.saving.set(true);
            this.errorMessage.set(null);
            try {
                await this.admin.updateAction(e.id, { enabled: e.enabled });
                await this.reload(true);
            }
            catch (err) {
                this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
            }
            finally {
                this.saving.set(false);
            }
        })();
    }
}
