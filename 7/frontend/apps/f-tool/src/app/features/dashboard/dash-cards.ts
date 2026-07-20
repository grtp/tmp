// features/dashboard/dash-cards.ts — ダッシュボードカードの表示整形(純粋関数)。
//
// 方針:
//   - hiddenKeys は非個人カードだけに効く(個人カードは × で実削除する
//     ため非表示リストに入らない。入っていても無視する)
//   - 保存済み並び順(cardOrder)は寛容マージ: 現存するキーだけを順に採用し，
//     不明キー(削除済みカード等)は黙って破棄，並び順に無い新カードは
//     生成順のまま末尾に付ける
//   - null の並び順は「未保存」= 生成順のまま
// DashCard 型は libs/ui 側にあるため，必要な形だけをジェネリクスで受ける。

/** arrangeCards が必要とする最小のカード形。 */
export interface ArrangeableCard {
  key: string;
  kind: string;
  personal?: boolean;
}

/** 非表示フィルタと保存済み並び順を適用して表示用のカード列を作る。 */
export function arrangeCards<T extends ArrangeableCard>(
  base: T[],
  order: string[] | null,
  hiddenKeys: string[],
): T[] {
  const hidden = new Set(hiddenKeys);
  const visible =
    hidden.size === 0 ? base : base.filter((c) => c.personal || c.kind === 'mylink' || !hidden.has(c.key));

  if (!order) return visible;
  const byKey = new Map(visible.map((c) => [c.key, c]));
  const out: T[] = [];
  for (const key of order) {
    const c = byKey.get(key);
    if (c) {
      out.push(c);
      byKey.delete(key);
    }
  }
  out.push(...byKey.values());
  return out;
}
