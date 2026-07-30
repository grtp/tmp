import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { apiErrorText } from './api-errors';

// TranslocoService のうち apiErrorText が使う 2 メソッドだけの構造的スタブ。
function transloco(lang: string, dict: Record<string, string>): TranslocoService {
  return {
    getActiveLang: () => lang,
    // 実サービス同様,訳が無いキーはキー文字列をそのまま返す。
    translate: (key: string) => dict[key] ?? key,
  } as unknown as TranslocoService;
}

function httpError(code: string | null, message: string | null): unknown {
  const body: Record<string, string> = {};
  if (code !== null) body['code'] = code;
  if (message !== null) body['message'] = message;
  return { error: body };
}

const dict = {
  'errors.conflict': 'Conflict occurred',
  'fallback.key': 'Fallback text',
};

describe('apiErrorText', () => {
  it('ja: サーバー文言を最優先する(コードの訳があっても)', () => {
    const err = httpError('conflict', '接続名 demoDB は既に存在します');
    expect(apiErrorText(transloco('ja', dict), err, 'fallback.key')).toBe(
      '接続名 demoDB は既に存在します',
    );
  });

  it('ja: サーバー文言が無ければ fallback キーの訳', () => {
    expect(apiErrorText(transloco('ja', dict), httpError('conflict', null), 'fallback.key')).toBe(
      'Fallback text',
    );
  });

  it('en: コード -> 辞書の訳を優先する(サーバー文言より)', () => {
    const err = httpError('conflict', 'サーバー側の日本語メッセージ');
    expect(apiErrorText(transloco('en', dict), err, 'fallback.key')).toBe('Conflict occurred');
  });

  it('en: 辞書に訳が無いコードはサーバー文言へフォールバック', () => {
    const err = httpError('unknown_code', 'server says hi');
    expect(apiErrorText(transloco('en', dict), err, 'fallback.key')).toBe('server says hi');
  });

  it('en: コードも文言も無ければ fallback キーの訳', () => {
    expect(apiErrorText(transloco('en', dict), {}, 'fallback.key')).toBe('Fallback text');
  });

  it('en: コード無し + サーバー文言ありは文言を使う', () => {
    expect(apiErrorText(transloco('en', dict), httpError(null, 'boom'), 'fallback.key')).toBe('boom');
  });
});
