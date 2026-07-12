import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

import { Lang, SUPPORTED_LANGS, storeLang } from '../i18n/provide-i18n';

/** 言語コード → 表示名。言語追加時はここと provide-i18n / 辞書を更新する。 */
const LANG_LABELS: Record<Lang, string> = {
  ja: '日本語',
  en: 'English',
};

/**
 * 言語切替プルダウン。選択は localStorage に永続化される。
 * ヘッダー(濃色背景)とログインカード(明色背景)の両方で使うため
 * variant で配色を切り替える。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-lang-select',
  templateUrl: './lang-select.html',
  styleUrl: './lang-select.css',
})
export class LangSelect {
  private transloco = inject(TranslocoService);

  /** 'on-primary' = ブランドカラー背景(ヘッダー)用の配色 */
  readonly variant = input<'default' | 'on-primary'>('default');

  protected readonly langs = SUPPORTED_LANGS;
  /** 実際の有効言語に常に追従する(表示と実言語の不一致を防ぐ)。 */
  protected readonly active = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  protected labelOf(lang: Lang): string {
    return LANG_LABELS[lang] ?? lang;
  }

  protected onChange(lang: string): void {
    const next = (SUPPORTED_LANGS as readonly string[]).includes(lang) ? (lang as Lang) : 'ja';
    this.transloco.setActiveLang(next);
    storeLang(next);
  }
}
