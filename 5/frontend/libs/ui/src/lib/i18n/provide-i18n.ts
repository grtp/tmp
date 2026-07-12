// libs/ui/src/lib/i18n/provide-i18n.ts
//
// FORGE の i18n プロバイダ。辞書(ja/en)はバンドルに静的同梱する:
//   - LAN 利用前提で HTTP ローダの失敗モードを持ち込まない
//   - 辞書は小さく、両言語込みでも数 KB
// アプリ本体と Storybook の両方がこの provider を使う(単一の真実)。
import { isDevMode } from '@angular/core';
import {
  provideTransloco,
  Translation,
  TranslocoLoader,
} from '@jsverse/transloco';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

import en from './en.json';
import ja from './ja.json';

export const SUPPORTED_LANGS = ['ja', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const LANG_STORAGE_KEY = 'forge.lang';

/** localStorage の言語設定(無効値は ja に落とす)。 */
export function storedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // localStorage が使えない環境(SSR等)では永続化しないだけ
  }
}

@Injectable()
export class StaticTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of((lang === 'en' ? en : ja) as Translation);
  }
}

/** アプリ/Storybook 共通の Transloco プロバイダ。 */
export function provideForgeI18n(defaultLang: Lang = storedLang()) {
  return provideTransloco({
    config: {
      availableLangs: [...SUPPORTED_LANGS],
      defaultLang,
      fallbackLang: 'ja',
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
    loader: StaticTranslocoLoader,
  });
}
