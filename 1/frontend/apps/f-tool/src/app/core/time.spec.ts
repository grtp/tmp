import { describe, expect, it } from 'vitest';

import { formatJst } from './time';

describe('formatJst', () => {
  it('UTC を +9 時間した JST 表記にする', () => {
    expect(formatJst('2026-07-21T03:15:22Z')).toBe('2026-07-21 12:15:22');
  });

  it('日付境界を越える(UTC 夕方 = JST 翌日)', () => {
    expect(formatJst('2026-07-20T15:10:50Z')).toBe('2026-07-21 00:10:50');
  });
});
