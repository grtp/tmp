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
interface WallClock {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
    seconds: number;
}
function wallClockOf(date: Date, timeZone?: string): WallClock {
    if (!timeZone) {
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            hours: date.getHours(),
            minutes: date.getMinutes(),
            seconds: date.getSeconds(),
        };
    }
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
        }).formatToParts(date);
        const n = (t: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
        return { year: n('year'), month: n('month'), day: n('day'), hours: n('hour') % 24, minutes: n('minute'), seconds: n('second') };
    }
    catch {
        return wallClockOf(date);
    }
}
function intlPart(date: Date, locale: ClockLocale, options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes, timeZone?: string): string {
    try {
        const parts = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', timeZone ? { ...options, timeZone } : options).formatToParts(date);
        return parts.find((p) => p.type === type)?.value ?? '';
    }
    catch {
        return '';
    }
}
function tokenValue(token: string, date: Date, locale: ClockLocale, afterHour: boolean, timeZone?: string): string {
    const w = wallClockOf(date, timeZone);
    switch (token) {
        case 'yyyy': return String(w.year);
        case 'yy': return pad2(w.year % 100);
        case 'MMMM': return intlPart(date, locale, { month: 'long' }, 'month', timeZone);
        case 'MMM': return intlPart(date, locale, { month: 'short' }, 'month', timeZone);
        case 'MM': return pad2(w.month);
        case 'M': return String(w.month);
        case 'dd': return pad2(w.day);
        case 'd': return String(w.day);
        case 'HH': return pad2(w.hours);
        case 'H': return String(w.hours);
        case 'hh': return pad2(w.hours % 12 || 12);
        case 'h': return String(w.hours % 12 || 12);
        case 'mm': return afterHour ? pad2(w.minutes) : pad2(w.month);
        case 'm': return afterHour ? String(w.minutes) : String(w.month);
        case 'ss': return pad2(w.seconds);
        case 's': return String(w.seconds);
        case 'EEEE': return intlPart(date, locale, { weekday: 'long' }, 'weekday', timeZone);
        case 'EEE':
        case 'E': return intlPart(date, locale, { weekday: 'short' }, 'weekday', timeZone);
        case 'a':
            return w.hours < 12
                ? (locale === 'ja' ? '午前' : 'AM')
                : (locale === 'ja' ? '午後' : 'PM');
        default: return token;
    }
}
const HOUR_TOKENS = new Set(['HH', 'H', 'hh', 'h']);
export function formatClock(pattern: string, date: Date, locale: ClockLocale, timeZone?: string): string {
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
        out += tokenValue(token, date, locale, afterHour, timeZone);
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
