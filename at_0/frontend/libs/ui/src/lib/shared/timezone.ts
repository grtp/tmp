export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    catch {
        return 'UTC';
    }
}
export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
export const TIME_ZONE_CHOICES: readonly string[] = [
    'UTC',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Taipei',
    'Asia/Singapore',
    'Asia/Bangkok',
    'Asia/Ho_Chi_Minh',
    'Asia/Jakarta',
    'Asia/Manila',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Amsterdam',
    'Europe/Warsaw',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'America/Mexico_City',
    'Australia/Sydney',
    'Pacific/Auckland',
];
export function timeZoneChoices(...extra: (string | undefined)[]): string[] {
    const out = [...TIME_ZONE_CHOICES];
    for (const tz of extra) {
        if (tz && !out.includes(tz) && isValidTimeZone(tz))
            out.unshift(tz);
    }
    return out;
}
export function zoneOffsetLabel(tz: string, at: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
            .formatToParts(at);
        const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
        const m = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name);
        if (!m)
            return 'UTC+00:00';
        return `UTC${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
    }
    catch {
        return 'UTC+00:00';
    }
}
export function timeZoneLabel(tz: string): string {
    return `${tz} (${zoneOffsetLabel(tz)})`;
}
export function formatInZone(iso: string, tz: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return iso;
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).formatToParts(d);
        const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? '';
        const hour = get('hour') === '24' ? '00' : get('hour');
        return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
    }
    catch {
        return iso;
    }
}
