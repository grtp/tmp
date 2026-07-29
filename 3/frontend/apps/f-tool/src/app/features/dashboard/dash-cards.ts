// features/dashboard/dash-cards.ts — ダッシュボードカードの変換(純粋関数)。
//
// 実体化コピー方式(2026-07-22 決定)では並び順・非表示の概念は無くなり，
// サーバーの ftool_app_user_dash_items が position 順でそのまま表示順になる。
// ここに残るのは「表示中のカード列 -> 保存用の項目配列」への変換だけ
// (カードの並べ替え確定・追加・削除・「現在の構成を保存」がすべてこれを経由する)。
// DashCard/GrantedAction 型は libs/ui・core 側にあるため，必要な形だけを
// ジェネリクスで受ける。

/** cardsToItemInputs が必要とする最小のカード形。 */
export interface ConvertibleCard {
  key: string;
  kind: 'function' | 'link' | 'table';
  name: string;
  icon: string;
  url?: string;
  tableId?: number;
  code?: string;
}

/** cardsToItemInputs が必要とする最小の権限エントリ形。 */
export interface ActionLike {
  code: string;
  id: number;
}

/** cardsToItemInputs が返す項目(UserDashItemInput の必要最小限)。 */
export interface DashItemInputLike {
  kind: 'action' | 'link' | 'table';
  actionId?: number;
  managedTableId?: number;
  name?: string;
  url?: string;
  icon?: string;
}

/**
 * 表示中のカード列を /me/dash-items PUT 用の項目配列へ変換する。
 * kind='function' は code から actionId を解決できないカード(権限を失った
 * 等)を黙って除外する。
 */
export function cardsToItemInputs<T extends ConvertibleCard>(
  cards: T[],
  actions: ActionLike[],
): DashItemInputLike[] {
  const out: DashItemInputLike[] = [];
  for (const c of cards) {
    if (c.kind === 'table') {
      if (!c.tableId) continue;
      out.push({ kind: 'table', managedTableId: c.tableId });
    } else if (c.kind === 'link') {
      out.push({ kind: 'link', name: c.name, url: c.url, icon: c.icon });
    } else {
      const actionId = actions.find((a) => a.code === c.code)?.id;
      if (!actionId) continue;
      out.push({ kind: 'action', actionId });
    }
  }
  return out;
}
