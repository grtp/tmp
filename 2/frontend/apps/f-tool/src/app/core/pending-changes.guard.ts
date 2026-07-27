// core/pending-changes.guard.ts — 未保存の編集内容がある画面からの離脱確認。
//
// 対象コンポーネントは ConfirmsLeave を実装し,離脱可否(必要なら確認
// ダイアログの結果)を返す。ガード自体はコンテナ実装に依存しない
// (型のみの依存。ルート定義から実体を import すると遅延ロードが
// 崩れるため,インターフェース経由にしている)。
import { CanDeactivateFn } from '@angular/router';

export interface ConfirmsLeave {
  /** true = 離脱してよい。未保存の内容があれば確認ダイアログを挟む。 */
  confirmLeave(): boolean | Promise<boolean>;
}

export const pendingChangesGuard: CanDeactivateFn<ConfirmsLeave> = (cmp) =>
  cmp.confirmLeave();
