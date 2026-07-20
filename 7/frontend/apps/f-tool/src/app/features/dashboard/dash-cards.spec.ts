import { describe, expect, it } from 'vitest';

import { ArrangeableCard, arrangeCards } from './dash-cards';

interface Card extends ArrangeableCard {
  name?: string;
}

function card(key: string, kind = 'function', personal?: boolean): Card {
  return personal ? { key, kind, personal } : { key, kind };
}

const keys = (cards: Card[]) => cards.map((c) => c.key);

describe('arrangeCards', () => {
  const base = [card('fn:a'), card('fn:b'), card('mylink:1', 'mylink'), card('tpl:9', 'link')];

  it('並び順もhiddenも無ければ生成順のまま', () => {
    expect(arrangeCards(base, null, [])).toEqual(base);
  });

  it('保存済み並び順を適用する', () => {
    expect(keys(arrangeCards(base, ['tpl:9', 'fn:a', 'mylink:1', 'fn:b'], []))).toEqual([
      'tpl:9',
      'fn:a',
      'mylink:1',
      'fn:b',
    ]);
  });

  it('不明キー(削除済みカード)は黙って破棄する', () => {
    expect(keys(arrangeCards(base, ['ghost:1', 'fn:b', 'gone:2', 'fn:a'], []))).toEqual([
      'fn:b',
      'fn:a',
      'mylink:1',
      'tpl:9',
    ]);
  });

  it('並び順に無い新カードは生成順のまま末尾に付く', () => {
    expect(keys(arrangeCards(base, ['fn:b'], []))).toEqual(['fn:b', 'fn:a', 'mylink:1', 'tpl:9']);
  });

  it('同じキーが並び順に重複しても1回だけ採用する', () => {
    expect(keys(arrangeCards(base, ['fn:a', 'fn:a', 'fn:b'], []))).toEqual([
      'fn:a',
      'fn:b',
      'mylink:1',
      'tpl:9',
    ]);
  });

  it('空の並び順([]) は「全カードが新規」= 生成順のまま(null とは別意味で同結果)', () => {
    expect(arrangeCards(base, [], [])).toEqual(base);
  });

  it('hiddenKeys は非個人カードを隠す', () => {
    expect(keys(arrangeCards(base, null, ['fn:a', 'tpl:9']))).toEqual(['fn:b', 'mylink:1']);
  });

  it('個人カード(personal / mylink)は hiddenKeys に入っていても隠れない', () => {
    const withPersonal = [card('fn:a'), card('mylink:1', 'mylink'), card('mylink:2', 'table', true)];
    expect(keys(arrangeCards(withPersonal, null, ['mylink:1', 'mylink:2', 'fn:a']))).toEqual([
      'mylink:1',
      'mylink:2',
    ]);
  });

  it('隠したカードは並び順に残っていても復活しない', () => {
    expect(keys(arrangeCards(base, ['fn:a', 'fn:b'], ['fn:a']))).toEqual(['fn:b', 'mylink:1', 'tpl:9']);
  });

  it('フィルタと並び順の複合(非表示 -> 並び替え -> 新カード末尾)', () => {
    const cards = [card('fn:a'), card('fn:b'), card('fn:c'), card('mylink:1', 'mylink')];
    expect(keys(arrangeCards(cards, ['fn:c', 'ghost:9', 'fn:a'], ['fn:b']))).toEqual([
      'fn:c',
      'fn:a',
      'mylink:1',
    ]);
  });

  it('入力配列は破壊しない', () => {
    const input = [card('fn:a'), card('fn:b')];
    const snapshot = [...input];
    arrangeCards(input, ['fn:b', 'fn:a'], ['fn:a']);
    expect(input).toEqual(snapshot);
  });
});
