import { describe, expect, it } from 'vitest';
import { formatInZone, isValidTimeZone, timeZoneChoices, zoneOffsetLabel, } from './timezone';
describe('formatInZone', () => {
    it('UTC の ISO 文字列を指定ゾーンの壁時計にする', () => {
        expect(formatInZone('2026-07-21T03:15:22Z', 'Asia/Tokyo')).toBe('2026-07-21 12:15:22');
        expect(formatInZone('2026-07-21T03:15:22Z', 'UTC')).toBe('2026-07-21 03:15:22');
        expect(formatInZone('2026-07-21T03:15:22Z', 'America/New_York')).toBe('2026-07-20 23:15:22');
    });
    it('日付境界を越える(UTC 夕方 = JST 翌日)/ 0 時は 00 で出す', () => {
        expect(formatInZone('2026-07-20T15:10:50Z', 'Asia/Tokyo')).toBe('2026-07-21 00:10:50');
    });
    it('解釈できない値はそのまま返す', () => {
        expect(formatInZone('not-a-date', 'Asia/Tokyo')).toBe('not-a-date');
    });
});
describe('zoneOffsetLabel', () => {
    it('UTC からのオフセットを UTC±HH:MM で返す', () => {
        const summer = new Date('2026-07-01T00:00:00Z');
        expect(zoneOffsetLabel('Asia/Tokyo', summer)).toBe('UTC+09:00');
        expect(zoneOffsetLabel('UTC', summer)).toBe('UTC+00:00');
        expect(zoneOffsetLabel('America/New_York', summer)).toBe('UTC-04:00');
        expect(zoneOffsetLabel('Asia/Kolkata', summer)).toBe('UTC+05:30');
    });
});
describe('isValidTimeZone / timeZoneChoices', () => {
    it('IANA 名の妥当性', () => {
        expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
        expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    });
    it('無い候補は先頭に足し,既にあるものは重複させない', () => {
        const c = timeZoneChoices('Asia/Tokyo', 'Europe/Rome', undefined);
        expect(c[0]).toBe('Europe/Rome');
        expect(c.filter((z) => z === 'Asia/Tokyo')).toHaveLength(1);
    });
});
