import { WritableSignal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

import { apiErrorText } from './api-errors';

/**
 * createReloadRunner は「保存中表示 → 実行 → 一覧を静かに再読込 →
 * 失敗ならエラーバナー」という設定画面コンテナ共通の定型を1つの関数に
 * まとめる(settings-tables-container 等
 * に同一実装の private run() が重複していたもの)。
 *
 * 依存(saving/errorMessage シグナルと reload)をクロージャで束ねて返すので,
 * 呼び出し側は `private readonly run = createReloadRunner(...)` と
 * フィールドで1回宣言し,あとは `this.run(() => action(), 'errors.xxx')` と
 * 呼ぶだけでよい。
 */
export function createReloadRunner(
  transloco: TranslocoService,
  saving: WritableSignal<boolean>,
  errorMessage: WritableSignal<string | null>,
  reload: (silent: boolean) => Promise<void>,
): (action: () => Promise<void>, fallbackKey: string) => Promise<void> {
  return async (action, fallbackKey) => {
    saving.set(true);
    errorMessage.set(null);
    try {
      await action();
      await reload(true);
    } catch (err) {
      errorMessage.set(apiErrorText(transloco, err, fallbackKey));
    } finally {
      saving.set(false);
    }
  };
}
