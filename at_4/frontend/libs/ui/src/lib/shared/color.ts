export function contrastTextColor(hex: string): string {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m)
        return '#000';
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return l > 0.4 ? '#000' : '#fff';
}
