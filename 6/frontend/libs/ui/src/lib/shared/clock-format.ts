// shared/clock-format — ヘッダー時計のカスタムフォーマッタ(純関数)。
// 数値系トークンは自前置換,名前系(曜日・月名・午前午後)だけ Intl から
// 取る。入力者は一般ユーザー想定なので寛容に倒す: 小文字 mm/m は
// 「時(HH/hh)より後ろなら分,前なら月」の文脈判定(Excel と同じ発想)で,
// yyyymmdd と HH:mm の両方が直感どおり動く。未知の文字はそのまま出力し,
// どんな入力でも例外は投げない。

export type ClockLocale = 'ja' | 'en';

/** ヘルプ表示用のトークン一覧(長いトークンから並べる。tokenize と同順)。 */
export const CLOCK_TOKENS = [
  'yyyy', 'yy',
  'MMMM', 'MMM', 'MM', 'M',
  'dd', 'd',
  'HH', 'H', 'hh', 'h',
  'mm', 'm',
  'ss', 's',
  'EEEE', 'EEE', 'E',
  'a',
] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

function intlPart(
  date: Date,
  locale: ClockLocale,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string {
  const parts = new Intl.DateTimeFormat(
    locale === 'ja' ? 'ja-JP' : 'en-US',
    options,
  ).formatToParts(date);
  return parts.find((p) => p.type === type)?.value ?? '';
}

function tokenValue(
  token: string,
  date: Date,
  locale: ClockLocale,
  afterHour: boolean,
): string {
  switch (token) {
    case 'yyyy': return String(date.getFullYear());
    case 'yy': return pad2(date.getFullYear() % 100);
    case 'MMMM': return intlPart(date, locale, { month: 'long' }, 'month');
    case 'MMM': return intlPart(date, locale, { month: 'short' }, 'month');
    case 'MM': return pad2(date.getMonth() + 1);
    case 'M': return String(date.getMonth() + 1);
    case 'dd': return pad2(date.getDate());
    case 'd': return String(date.getDate());
    case 'HH': return pad2(date.getHours());
    case 'H': return String(date.getHours());
    case 'hh': return pad2(date.getHours() % 12 || 12);
    case 'h': return String(date.getHours() % 12 || 12);
    case 'mm': return afterHour ? pad2(date.getMinutes()) : pad2(date.getMonth() + 1);
    case 'm': return afterHour ? String(date.getMinutes()) : String(date.getMonth() + 1);
    case 'ss': return pad2(date.getSeconds());
    case 's': return String(date.getSeconds());
    case 'EEEE': return intlPart(date, locale, { weekday: 'long' }, 'weekday');
    case 'EEE':
    case 'E': return intlPart(date, locale, { weekday: 'short' }, 'weekday');
    case 'a':
      return date.getHours() < 12
        ? (locale === 'ja' ? '午前' : 'AM')
        : (locale === 'ja' ? '午後' : 'PM');
    default: return token;
  }
}

const HOUR_TOKENS = new Set(['HH', 'H', 'hh', 'h']);

/**
 * pattern を現在時刻の文字列に変換する。トークン以外の文字はそのまま,
 * 文字をそのまま出したい場合は '...' で囲む('' はクォート1文字)。
 */
export function formatClock(
  pattern: string,
  date: Date,
  locale: ClockLocale,
): string {
  let out = '';
  let afterHour = false;
  let i = 0;
  while (i < pattern.length) {
    // クォート: '...' 内は無加工。'' は ' 自体
    if (pattern[i] === "'") {
      if (pattern[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      const end = pattern.indexOf("'", i + 1);
      if (end === -1) {
        out += pattern.slice(i + 1);
        break;
      }
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const token = CLOCK_TOKENS.find((t) => pattern.startsWith(t, i));
    if (token === undefined) {
      out += pattern[i];
      i += 1;
      continue;
    }
    out += tokenValue(token, date, locale, afterHour);
    if (HOUR_TOKENS.has(token)) afterHour = true;
    i += token.length;
  }
  return out;
}

/** ヘルプ用: 各トークンと「今この瞬間の置換結果」のペア。 */
export function clockTokenExamples(
  date: Date,
  locale: ClockLocale,
): { token: string; value: string }[] {
  return CLOCK_TOKENS.map((token) => ({
    token,
    // mm/m は時刻文脈(分)の例として見せる(月は MM/M の行が担う)
    value: tokenValue(token, date, locale, true),
  }));
}
