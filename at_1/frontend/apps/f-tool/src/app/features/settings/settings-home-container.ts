import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { HomeBuilder, HomeWidgetConfig, RequiresOption } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { HomeApi } from '../../core/api/home-api';
import { AuthService } from '../../core/auth/auth.service';
import { confirmAsync } from '../../core/dialog';
import { fnLabel } from '../../core/fn-label';
import { Action } from '../../core/models';
import { ConfirmsLeave } from '../../core/pending-changes.guard';
import { parseHomeConfig, visibleWidgets } from '../home/home-config';
function canonical(widgets: HomeWidgetConfig[]): string {
    return JSON.stringify({ version: 1, widgets });
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-home-container',
    styles: ':host { display: contents; }',
    imports: [HomeBuilder],
    templateUrl: './settings-home-container.html',
})
export class SettingsHomeContainer implements ConfirmsLeave {
    private homeApi = inject(HomeApi);
    private admin = inject(AdminApi);
    private auth = inject(AuthService);
    private dialog = inject(MatDialog);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly widgets = signal<HomeWidgetConfig[]>([]);
    protected readonly previewWidgets = computed(() => visibleWidgets(this.widgets(), (code) => this.auth.allows(code, 'user')));
    private readonly savedCanonical = signal(canonical([]));
    protected readonly dirty = computed(() => canonical(this.widgets()) !== this.savedCanonical());
    protected readonly saving = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly jsonError = signal<string | null>(null);
    private readonly actions = signal<Action[]>([]);
    protected readonly requiresOptions = computed<RequiresOption[]>(() => {
        void this.lang();
        return this.actions().map((a) => ({
            code: a.code,
            label: fnLabel(this.transloco, a.code, a.name),
        }));
    });
    constructor() {
        void this.load();
    }
    private defaultWidgets(): HomeWidgetConfig[] {
        return [{
                type: 'cards',
                size: 3,
                items: this.actions()
                    .filter((a) => a.enabled)
                    .map((a) => ({
                    label: fnLabel(this.transloco, a.code, a.name),
                    url: '/' + a.code,
                    icon: a.icon,
                    requires: a.code,
                })),
            }];
    }
    private async load(): Promise<void> {
        try {
            const [cfg, actions] = await Promise.all([
                this.homeApi.getHomeConfig(),
                this.admin.listActions(),
            ]);
            this.actions.set(actions);
            const parsed = cfg.config !== null ? parseHomeConfig(cfg.config) : null;
            const widgets = parsed ?? this.defaultWidgets();
            this.widgets.set(widgets);
            this.savedCanonical.set(canonical(widgets));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
    }
    protected onWidgetsChanged(next: HomeWidgetConfig[]): void {
        this.jsonError.set(null);
        this.widgets.set(next);
    }
    protected async onSave(): Promise<void> {
        const t = (key: string) => this.transloco.translate(key);
        const ok = await confirmAsync(this.dialog, {
            title: t('homeBuilder.saveTitle'),
            message: t('homeBuilder.saveMessage'),
            confirmLabel: t('homeBuilder.save'),
        });
        if (!ok)
            return;
        this.saving.set(true);
        this.errorMessage.set(null);
        try {
            const json = canonical(this.widgets());
            await this.homeApi.setHomeConfig(json);
            this.savedCanonical.set(json);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
        }
        finally {
            this.saving.set(false);
        }
    }
    protected async onReset(): Promise<void> {
        const t = (key: string) => this.transloco.translate(key);
        const ok = await confirmAsync(this.dialog, {
            title: t('homeBuilder.resetTitle'),
            message: t('homeBuilder.resetMessage'),
            confirmLabel: t('homeBuilder.reset'),
            danger: true,
        });
        if (!ok)
            return;
        this.saving.set(true);
        this.errorMessage.set(null);
        try {
            await this.homeApi.setHomeConfig(null);
            const widgets = this.defaultWidgets();
            this.widgets.set(widgets);
            this.savedCanonical.set(canonical(widgets));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
        }
        finally {
            this.saving.set(false);
        }
    }
    protected onJsonApplied(text: string): void {
        const parsed = parseHomeConfig(text);
        if (parsed === null) {
            this.jsonError.set(this.transloco.translate('homeBuilder.jsonInvalid'));
            return;
        }
        this.jsonError.set(null);
        this.widgets.set(parsed);
    }
    confirmLeave(): boolean | Promise<boolean> {
        if (!this.dirty())
            return true;
        const t = (key: string) => this.transloco.translate(key);
        return confirmAsync(this.dialog, {
            title: t('homeBuilder.leaveTitle'),
            message: t('homeBuilder.leaveMessage'),
            confirmLabel: t('homeBuilder.leaveConfirm'),
            danger: true,
        });
    }
}
