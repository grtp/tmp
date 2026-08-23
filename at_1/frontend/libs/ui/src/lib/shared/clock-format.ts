export type ClockLocale = 'ja' | 'en';
export const CLOCK_TOKENS = [
    'yyyy', 'yy',
    'MMMM', 'MMM', 'MM', 'M',
    'dd', 'd',
    'HH', 'H', 'hh', 'h',
    'mm', 'm',
    'ss', 's',
    'EEEE', 'EEE', 'E',
    'a',
] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');
function intlPart(date: Date, locale: ClockLocale, options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes): string {
    const parts = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', options).formatToParts(date);
    return parts.find((p) => p.type === type)?.value ?? '';
}
function tokenValue(token: string, date: Date, locale: ClockLocale, afterHour: boolean): string {
    switch (token) {
        case 'yyyy': return String(date.getFullYear());
        case 'yy': return pad2(date.getFullYear() % 100);
        case 'MMMM': return intlPart(date, locale, { month: 'long' }, 'month');
        case 'MMM': return intlPart(date, locale, { month: 'short' }, 'month');
        case 'MM': return pad2(date.getMonth() + 1);
        case 'M': return String(date.getMonth() + 1);
        case 'dd': return pad2(date.getDate());
        case 'd': return String(date.getDate());
        case 'HH': return pad2(date.getHours());
        case 'H': return String(date.getHours());
        case 'hh': return pad2(date.getHours() % 12 || 12);
        case 'h': return String(date.getHours() % 12 || 12);
        case 'mm': return afterHour ? pad2(date.getMinutes()) : pad2(date.getMonth() + 1);
        case 'm': return afterHour ? String(date.getMinutes()) : String(date.getMonth() + 1);
        case 'ss': return pad2(date.getSeconds());
        case 's': return String(date.getSeconds());
        case 'EEEE': return intlPart(date, locale, { weekday: 'long' }, 'weekday');
        case 'EEE':
        case 'E': return intlPart(date, locale, { weekday: 'short' }, 'weekday');
        case 'a':
            return date.getHours() < 12
                ? (locale === 'ja' ? '午前' : 'AM')
                : (locale === 'ja' ? '午後' : 'PM');
        default: return token;
    }
}
const HOUR_TOKENS = new Set(['HH', 'H', 'hh', 'h']);
export function formatClock(pattern: string, date: Date, locale: ClockLocale): string {
    let out = '';
    let afterHour = false;
    let i = 0;
    while (i < pattern.length) {
        if (pattern[i] === "'") {
            if (pattern[i + 1] === "'") {
                out += "'";
                i += 2;
                continue;
            }
            const end = pattern.indexOf("'", i + 1);
            if (end === -1) {
                out += pattern.slice(i + 1);
                break;
            }
            out += pattern.slice(i + 1, end);
            i = end + 1;
            continue;
        }
        const token = CLOCK_TOKENS.find((t) => pattern.startsWith(t, i));
        if (token === undefined) {
            out += pattern[i];
            i += 1;
            continue;
        }
        out += tokenValue(token, date, locale, afterHour);
        if (HOUR_TOKENS.has(token))
            afterHour = true;
        i += token.length;
    }
    return out;
}
export function clockTokenExamples(date: Date, locale: ClockLocale): {
    token: string;
    value: string;
}[] {
    return CLOCK_TOKENS.map((token) => ({
        token,
        value: tokenValue(token, date, locale, true),
    }));
}
