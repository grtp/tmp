import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { PwchangeLookup, PwchangePage, PwchangeSubmit, PwchangeTargetCard } from '@f-tool/ui';
import { apiErrorText } from '../../core/api-errors';
import { PwchangeApi } from '../../core/api/pwchange-api';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorCode } from '../../core/models';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-pwchange-container',
    styles: ':host { display: contents; }',
    imports: [PwchangePage],
    templateUrl: './pwchange-container.html',
})
export class PwchangeContainer {
    private api = inject(PwchangeApi);
    private auth = inject(AuthService);
    private transloco = inject(TranslocoService);
    protected readonly loading = signal(true);
    protected readonly employeeNo = signal<string | undefined>(undefined);
    protected readonly targets = signal<PwchangeTargetCard[]>([]);
    protected readonly selectedId = signal<number | null>(null);
    protected readonly lookup = signal<PwchangeLookup | null>(null);
    protected readonly busy = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly done = signal(false);
    protected readonly identity = computed(() => {
        const u = this.auth.me()?.username;
        return u ? [u] : [];
    });
    constructor() {
        void this.load();
    }
    private async load(silent = false): Promise<void> {
        if (!silent)
            this.loading.set(true);
        try {
            const res = await this.api.listTargets();
            this.employeeNo.set(res.employeeNo);
            this.targets.set(res.targets.map((t) => ({
                id: t.id,
                connectionName: t.connectionName,
                color: t.connectionColor,
                consented: t.consented,
                locked: t.locked,
                lockRemainingSec: t.lockRemainingSec,
                maxFailures: t.maxFailures,
                lockMinutes: t.lockMinutes,
                policy: t.policy,
            })));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
        }
        finally {
            if (!silent)
                this.loading.set(false);
        }
    }
    protected async onSelect(id: number): Promise<void> {
        this.errorMessage.set(null);
        this.done.set(false);
        this.lookup.set(null);
        this.selectedId.set(id);
        try {
            const r = await this.api.lookup(id);
            this.lookup.set({ matched: r.matched, name: r.name });
            const t = this.targets().find((x) => x.id === id);
            if (t?.consented && r.matched !== 1) {
                this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: false } : x)));
            }
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
            this.selectedId.set(null);
        }
    }
    protected async onConsent(): Promise<void> {
        const id = this.selectedId();
        if (id === null)
            return;
        this.busy.set(true);
        this.errorMessage.set(null);
        try {
            await this.api.consent(id);
            this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: true } : x)));
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
        }
        finally {
            this.busy.set(false);
        }
    }
    protected async onChange(e: PwchangeSubmit): Promise<void> {
        const id = this.selectedId();
        if (id === null)
            return;
        this.busy.set(true);
        this.errorMessage.set(null);
        try {
            await this.api.change(id, e.currentPassword, e.newPassword);
            this.done.set(true);
            await this.load(true);
        }
        catch (err) {
            this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.updateFailed'));
            const code = apiErrorCode(err);
            const lockedNow = (err as {
                error?: {
                    details?: {
                        locked?: boolean;
                    };
                };
            })?.error?.details?.locked === true;
            if (code === 'locked' || lockedNow) {
                await this.load(true);
                this.selectedId.set(null);
            }
            else if (code === 'consent_required') {
                this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: false } : x)));
            }
        }
        finally {
            this.busy.set(false);
        }
    }
    protected onBack(): void {
        this.errorMessage.set(null);
        this.done.set(false);
        this.lookup.set(null);
        this.selectedId.set(null);
    }
}
