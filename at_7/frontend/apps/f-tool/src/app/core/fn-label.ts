import { TranslocoService } from '@jsverse/transloco';
export function fnLabel(transloco: TranslocoService, code: string, fallback: string): string {
    const key = `functions.${code}`;
    const v = transloco.translate(key);
    return v === key ? fallback : v;
}
