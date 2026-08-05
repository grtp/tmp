import { describe, expect, it } from 'vitest';

import { clockTokenExamples, formatClock } from './clock-format';

// 2026-08-05(水) 13:24:38 ローカル時刻
const d = new Date(2026, 7, 5, 13, 24, 38);

describe('formatClock', () => {
  it('基本トークン(年月日・24h時分秒)', () => {
    expect(formatClock('yyyy/MM/dd HH:mm:ss', d, 'ja')).toBe('2026/08/05 13:24:38');
    expect(formatClock('yy-M-d H:m:s', d, 'ja')).toBe('26-8-5 13:24:38');
  });

  it('小文字 mm は文脈判定: 時より前は月, 後ろは分', () => {
    expect(formatClock('yyyymmdd', d, 'ja')).toBe('20260805');
    expect(formatClock('HH:mm', d, 'ja')).toBe('13:24');
    expect(formatClock('mm/dd hh:mm', d, 'ja')).toBe('08/05 01:24');
  });

  it('12時間制と午前/午後(ロケール追従)', () => {
    expect(formatClock('h:mm a', d, 'ja')).toBe('1:24 午後');
    expect(formatClock('h:mm a', d, 'en')).toBe('1:24 PM');
    const am = new Date(2026, 7, 5, 0, 5, 0);
    expect(formatClock('hh:mm a', am, 'en')).toBe('12:05 AM');
  });

  it('曜日・月名は Intl から(ja/en 切替)', () => {
    expect(formatClock('(E)', d, 'ja')).toBe('(水)');
    expect(formatClock('E', d, 'en')).toBe('Wed');
    expect(formatClock('EEEE', d, 'en')).toBe('Wednesday');
    expect(formatClock('MMM d, yyyy', d, 'en')).toBe('Aug 5, 2026');
  });

  it('トークン以外はそのまま, クォートで無加工リテラル', () => {
    expect(formatClock('yyyy年M月d日', d, 'ja')).toBe('2026年8月5日');
    expect(formatClock("'day:' dd", d, 'en')).toBe('day: 05');
    expect(formatClock("''", d, 'ja')).toBe("'");
    expect(formatClock("'閉じ忘れ", d, 'ja')).toBe('閉じ忘れ');
  });

  it('英語圏の定型', () => {
    expect(formatClock('EEE, MM/dd/yyyy h:mm a', d, 'en')).toBe('Wed, 08/05/2026 1:24 PM');
    expect(formatClock('dd/MM/yyyy', d, 'en')).toBe('05/08/2026');
  });
});

describe('clockTokenExamples', () => {
  it('全トークンの置換例を返す(mm は分の例)', () => {
    const rows = clockTokenExamples(d, 'ja');
    const map = new Map(rows.map((r) => [r.token, r.value]));
    expect(map.get('yyyy')).toBe('2026');
    expect(map.get('mm')).toBe('24');
    expect(map.get('MM')).toBe('08');
    expect(map.get('E')).toBe('水');
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });
});
