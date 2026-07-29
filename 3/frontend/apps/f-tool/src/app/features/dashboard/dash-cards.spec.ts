import { describe, expect, it } from 'vitest';

import { ActionLike, ConvertibleCard, cardsToItemInputs } from './dash-cards';

const actions: ActionLike[] = [
  { code: 'table-maint', id: 1 },
  { code: 'history', id: 2 },
];

describe('cardsToItemInputs', () => {
  it('function カードは code から actionId を解決する', () => {
    const cards: ConvertibleCard[] = [
      { key: 'fn:table-maint', kind: 'function', name: 'x', icon: 'table_view', code: 'table-maint' },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([
      { kind: 'action', actionId: 1 },
    ]);
  });

  it('table カードは tableId を managedTableId として渡す', () => {
    const cards: ConvertibleCard[] = [
      { key: 'item:1', kind: 'table', name: 'x', icon: 'table_view', tableId: 42 },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([
      { kind: 'table', managedTableId: 42 },
    ]);
  });

  it('link カードは name/url/icon をそのまま渡す', () => {
    const cards: ConvertibleCard[] = [
      { key: 'item:2', kind: 'link', name: 'Wiki', icon: 'open_in_new', url: 'https://a/' },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([
      { kind: 'link', name: 'Wiki', url: 'https://a/', icon: 'open_in_new' },
    ]);
  });

  it('権限を失った(actions に無い)function カードは除外する', () => {
    const cards: ConvertibleCard[] = [
      { key: 'fn:gone', kind: 'function', name: 'x', icon: 'x', code: 'gone' },
      { key: 'fn:history', kind: 'function', name: 'y', icon: 'y', code: 'history' },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([
      { kind: 'action', actionId: 2 },
    ]);
  });

  it('tableId の無い table カードは除外する', () => {
    const cards: ConvertibleCard[] = [
      { key: 'item:3', kind: 'table', name: 'x', icon: 'table_view' },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([]);
  });

  it('並び順(配列順)はそのまま保持する', () => {
    const cards: ConvertibleCard[] = [
      { key: 'item:2', kind: 'link', name: 'b', icon: 'i', url: 'https://b/' },
      { key: 'fn:table-maint', kind: 'function', name: 'a', icon: 'i', code: 'table-maint' },
    ];
    expect(cardsToItemInputs(cards, actions)).toEqual([
      { kind: 'link', name: 'b', url: 'https://b/', icon: 'i' },
      { kind: 'action', actionId: 1 },
    ]);
  });
});
