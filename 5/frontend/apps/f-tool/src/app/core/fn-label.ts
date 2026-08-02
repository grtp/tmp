// core/fn-label.ts — 組込機能名の表示用翻訳。
import { TranslocoService } from '@jsverse/transloco';

/**
 * 組込機能(table-maint/settings/history 等)の名前を言語切替に追従させる。
 * `functions.<code>` 辞書キーがあればそれを使い,無ければ DB の name を
 * そのまま使う(カスタム機能はユーザー入力値なので翻訳しない)。
 */
export function fnLabel(transloco: TranslocoService, code: string, fallback: string): string {
  const key = `functions.${code}`;
  const v = transloco.translate(key);
  return v === key ? fallback : v;
}
