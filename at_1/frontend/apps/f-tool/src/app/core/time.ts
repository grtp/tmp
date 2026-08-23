export function formatJst(iso: string): string {
    const jst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return jst.toISOString().slice(0, 19).replace('T', ' ');
}
