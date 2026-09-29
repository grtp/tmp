import { ChangeDetectionStrategy, Component, computed, inject, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HomePage, HomeWidget } from '@f-tool/ui';
import { HomeApi } from '../../core/api/home-api';
import { AuthService } from '../../core/auth/auth.service';
import { fnLabel } from '../../core/fn-label';
import { ConfiguredWidget, parseHomeConfig, visibleWidgets, } from './home-config';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-container',
    styles: ':host { display: contents; }',
    imports: [HomePage, TranslocoPipe],
    templateUrl: './home-container.html',
})
export class HomeContainer {
    private api = inject(HomeApi);
    private auth = inject(AuthService);
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    private readonly config = signal<string | null | undefined>(undefined);
    constructor() {
        void this.load();
    }
    private async load(): Promise<void> {
        try {
            this.config.set((await this.api.getHomeConfig()).config);
        }
        catch {
            this.config.set(null);
        }
    }
    protected readonly widgets = computed<HomeWidget[] | null>(() => {
        void this.lang();
        const c = this.config();
        if (c === undefined)
            return null;
        const parsed = c !== null ? parseHomeConfig(c) : null;
        return visibleWidgets(parsed ?? this.fallback(), (code) => this.auth.allows(code, 'user'));
    });
    private fallback(): ConfiguredWidget[] {
        return [{
                type: 'cards',
                size: 3,
                items: this.auth.actions().map((a) => ({
                    label: fnLabel(this.transloco, a.code, a.name),
                    url: '/' + a.code,
                    icon: a.icon,
                })),
            }];
    }
    protected open(url: string): void {
        if (url.startsWith('/')) {
            void this.router.navigateByUrl(url);
        }
        else {
            window.open(url, '_blank', 'noopener');
        }
    }
}
