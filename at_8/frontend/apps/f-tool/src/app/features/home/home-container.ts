import { ChangeDetectionStrategy, Component, computed, inject, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HomeActionItem, HomePage } from '@f-tool/ui';
import { AuthService } from '../../core/auth/auth.service';
import { fnLabel } from '../../core/fn-label';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-container',
    styles: ':host { display: contents; }',
    imports: [HomePage, TranslocoPipe],
    templateUrl: './home-container.html',
})
export class HomeContainer {
    private auth = inject(AuthService);
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.selectTranslation());
    protected readonly items = computed<HomeActionItem[]>(() => {
        void this.lang();
        return this.auth.actions().map((a) => ({
            code: a.code,
            label: fnLabel(this.transloco, a.code, a.name),
            icon: a.icon,
        }));
    });
    protected open(code: string): void {
        void this.router.navigateByUrl('/' + code);
    }
}
