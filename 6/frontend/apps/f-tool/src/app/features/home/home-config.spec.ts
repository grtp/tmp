import { describe, expect, it } from 'vitest';

import { parseHomeConfig, visibleWidgets } from './home-config';

describe('parseHomeConfig', () => {
  it('壊れた JSON / widgets 配列なしは null(既定表示へフォールバック)', () => {
    expect(parseHomeConfig('{broken')).toBeNull();
    expect(parseHomeConfig('"string"')).toBeNull();
    expect(parseHomeConfig('{"version":1}')).toBeNull();
    expect(parseHomeConfig('{"widgets":{}}')).toBeNull();
  });

  it('未知 type と必須値欠落の要素はスキップし,残りを生かす', () => {
    const ws = parseHomeConfig(JSON.stringify({
      widgets: [
        { type: 'heading', text: 'ok' },
        { type: 'unknown', text: 'x' },
        { type: 'heading' },
        { type: 'note', text: '' },
        'garbage',
        { type: 'divider' },
      ],
    }));
    expect(ws?.map((w) => w.type)).toEqual(['heading', 'divider']);
  });

  it('size は 1/2 のみ有効で,それ以外は 3 に落とす', () => {
    const ws = parseHomeConfig(JSON.stringify({
      widgets: [
        { type: 'heading', text: 'a', size: 1 },
        { type: 'heading', text: 'b', size: 2 },
        { type: 'heading', text: 'c', size: 99 },
        { type: 'heading', text: 'd' },
      ],
    }));
    expect(ws?.map((w) => w.size)).toEqual([1, 2, 3, 3]);
  });

  it('items は label と url がそろった要素だけ拾う', () => {
    const ws = parseHomeConfig(JSON.stringify({
      widgets: [{
        type: 'rows',
        items: [
          { label: '勤怠', url: 'https://x', icon: 'schedule', desc: '打刻' },
          { label: '', url: 'https://x' },
          { label: 'urlなし' },
          { label: 'メンテ', url: '/tables' },
          123,
        ],
      }],
    }));
    expect(ws).toHaveLength(1);
    const rows = ws?.[0];
    if (rows?.type !== 'rows') throw new Error('rows expected');
    expect(rows.items.map((i) => i.label)).toEqual(['勤怠', 'メンテ']);
    expect(rows.items[0]).toEqual({
      label: '勤怠', url: 'https://x', icon: 'schedule', desc: '打刻',
    });
    expect(rows.items[1].icon).toBeUndefined();
  });

  it('note の tone は warn 以外を info に落とす', () => {
    const ws = parseHomeConfig(JSON.stringify({
      widgets: [
        { type: 'note', text: 'a', tone: 'warn' },
        { type: 'note', text: 'b', tone: 'danger' },
        { type: 'note', text: 'c' },
      ],
    }));
    expect(ws?.map((w) => (w.type === 'note' ? w.tone : ''))).toEqual([
      'warn', 'info', 'info',
    ]);
  });
});

describe('visibleWidgets', () => {
  it('requires 指定のウィジェットは権限が無ければ隠し,出力からは requires を落とす', () => {
    const parsed = parseHomeConfig(JSON.stringify({
      widgets: [
        { type: 'heading', text: '全員' },
        { type: 'heading', text: '管理者向け', requires: 'settings' },
        { type: 'cards', requires: 'tables', items: [] },
      ],
    }));
    if (parsed === null) throw new Error('parse failed');

    const forUser = visibleWidgets(parsed, (code) => code === 'tables');
    expect(forUser.map((w) => (w.type === 'heading' ? w.text : w.type))).toEqual([
      '全員', 'cards',
    ]);
    expect(forUser.some((w) => 'requires' in w)).toBe(false);

    const forAdmin = visibleWidgets(parsed, () => true);
    expect(forAdmin).toHaveLength(3);
  });

  it('項目単位の requires も権限でフィルタされる(組込既定の実体化で使用)', () => {
    const parsed = parseHomeConfig(JSON.stringify({
      widgets: [{
        type: 'cards',
        items: [
          { label: 'テーブル管理', url: '/tables', requires: 'tables' },
          { label: '設定', url: '/settings', requires: 'settings' },
          { label: '誰でも', url: 'https://x' },
        ],
      }],
    }));
    if (parsed === null) throw new Error('parse failed');

    const forUser = visibleWidgets(parsed, (code) => code === 'tables');
    const cards = forUser[0];
    if (cards?.type !== 'cards') throw new Error('cards expected');
    expect(cards.items.map((i) => i.label)).toEqual(['テーブル管理', '誰でも']);
  });
});
