// core/api-errors.ts — API エラーの表示文言を言語に応じて解決する。
//
// 方針:
//   - 日本語(ja)ではサーバーのメッセージを優先する(より具体的なため。
//     例:「接続名 demoDB は既に存在します」)
//   - それ以外の言語ではエラーコード -> 辞書(errors.*) の訳文を優先し，
//     訳が無ければサーバーメッセージ，それも無ければ fallbackKey の訳文
import { TranslocoService } from '@jsverse/transloco';

import { apiErrorCode, apiErrorMessage } from './models';

export function apiErrorText(
  transloco: TranslocoService,
  err: unknown,
  fallbackKey: string,
): string {
  const fallback = transloco.translate(fallbackKey);
  const serverMsg = apiErrorMessage(err, '');

  if (transloco.getActiveLang() === 'ja') {
    return serverMsg || fallback;
  }

  const code = apiErrorCode(err);
  if (code) {
    const key = `errors.${code}`;
    const translated = transloco.translate(key);
    if (translated && translated !== key) return translated;
  }
  return serverMsg || fallback;
}
