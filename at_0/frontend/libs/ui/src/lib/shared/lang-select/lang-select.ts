import { ChangeDetectionStrategy, Component, inject, input, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoService } from '@jsverse/transloco';
import { Lang, SUPPORTED_LANGS, storeLang } from '../i18n/provide-i18n';
const LANG_LABELS: Record<Lang, string> = {
    ja: '日本語',
    en: 'English',
};
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-lang-select',
    imports: [MatFormFieldModule, MatSelectModule],
    templateUrl: './lang-select.html',
    styleUrl: './lang-select.css',
})
export class LangSelect {
    private transloco = inject(TranslocoService);
    readonly variant = input<'default' | 'on-primary'>('default');
    protected readonly langs = SUPPORTED_LANGS;
    protected readonly active = toSignal(this.transloco.langChanges$, {
        initialValue: this.transloco.getActiveLang(),
    });
    protected labelOf(lang: Lang): string {
        return LANG_LABELS[lang] ?? lang;
    }
    protected onChange(lang: string): void {
        const next = (SUPPORTED_LANGS as readonly string[]).includes(lang)
            ? (lang as Lang)
            : 'ja';
        this.transloco.setActiveLang(next);
        storeLang(next);
    }
}
