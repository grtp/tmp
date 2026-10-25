import { describe, expect, it } from 'vitest';
import { computeOffset } from './server-clock-offset';
describe('computeOffset', () => {
    it('往復遅延の中間でサーバー時刻を受け取ったとみなして差を出す', () => {
        expect(computeOffset(6100, 1000, 1200)).toBe(5000);
    });
    it('端末が進んでいれば負の差になる', () => {
        expect(computeOffset(1000, 4000, 4000)).toBe(-3000);
    });
});
