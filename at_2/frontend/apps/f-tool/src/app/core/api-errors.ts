import { TranslocoService } from '@jsverse/transloco';
import { apiErrorCode, apiErrorMessage } from './models';
export function apiErrorText(transloco: TranslocoService, err: unknown, fallbackKey: string): string {
    const fallback = transloco.translate(fallbackKey);
    const serverMsg = apiErrorMessage(err, '');
    if (transloco.getActiveLang() === 'ja') {
        return serverMsg || fallback;
    }
    const code = apiErrorCode(err);
    if (code) {
        const key = `errors.${code}`;
        const translated = transloco.translate(key);
        if (translated && translated !== key)
            return translated;
    }
    return serverMsg || fallback;
}
