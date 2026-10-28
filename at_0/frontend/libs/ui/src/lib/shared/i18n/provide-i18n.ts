import { isDevMode } from '@angular/core';
import { provideTransloco, Translation, TranslocoLoader, } from '@jsverse/transloco';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import en from './en.json';
import ja from './ja.json';
export const SUPPORTED_LANGS = ['ja', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const LANG_STORAGE_KEY = 'ftool.lang';
export function storedLang(): Lang {
    try {
        const v = localStorage.getItem(LANG_STORAGE_KEY);
        return v === 'en' ? 'en' : 'ja';
    }
    catch {
        return 'ja';
    }
}
export function storeLang(lang: Lang): void {
    try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
    }
    catch {
    }
}
@Injectable()
export class StaticTranslocoLoader implements TranslocoLoader {
    getTranslation(lang: string): Observable<Translation> {
        return of((lang === 'en' ? en : ja) as Translation);
    }
}
export function provideFToolI18n(defaultLang: Lang = storedLang()) {
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
