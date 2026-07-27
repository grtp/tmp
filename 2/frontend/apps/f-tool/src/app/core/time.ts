/** formatJst は UTC の ISO 文字列を JST(+09:00)の 'YYYY-MM-DD HH:mm:ss' 表記にする。 */
export function formatJst(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 19).replace('T', ' ');
}
