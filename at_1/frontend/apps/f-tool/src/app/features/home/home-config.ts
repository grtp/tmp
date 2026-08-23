import { HomeLinkItem, HomeWidget, HomeWidgetConfig, HomeWidgetSize, } from '@f-tool/ui';
export type ConfiguredWidget = HomeWidgetConfig;
const WIDGET_TYPES = new Set([
    'hero', 'heading', 'text', 'note', 'divider', 'rows', 'pills', 'cards',
]);
function asSize(v: unknown): HomeWidgetSize {
    return v === 1 || v === 2 ? v : 3;
}
function asText(v: unknown): string {
    return typeof v === 'string' ? v : '';
}
function asItems(v: unknown): HomeLinkItem[] {
    if (!Array.isArray(v))
        return [];
    const out: HomeLinkItem[] = [];
    for (const raw of v) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const it = raw as Record<string, unknown>;
        if (typeof it['label'] !== 'string' || typeof it['url'] !== 'string')
            continue;
        if (it['label'] === '' || it['url'] === '')
            continue;
        out.push({
            label: it['label'],
            url: it['url'],
            icon: typeof it['icon'] === 'string' && it['icon'] !== '' ? it['icon'] : undefined,
            desc: typeof it['desc'] === 'string' && it['desc'] !== '' ? it['desc'] : undefined,
            requires: typeof it['requires'] === 'string' && it['requires'] !== ''
                ? it['requires']
                : undefined,
        });
    }
    return out;
}
export function parseHomeConfig(json: string): ConfiguredWidget[] | null {
    let root: unknown;
    try {
        root = JSON.parse(json);
    }
    catch {
        return null;
    }
    if (typeof root !== 'object' || root === null)
        return null;
    const widgets = (root as Record<string, unknown>)['widgets'];
    if (!Array.isArray(widgets))
        return null;
    const out: ConfiguredWidget[] = [];
    for (const raw of widgets) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const w = raw as Record<string, unknown>;
        const type = w['type'];
        if (typeof type !== 'string' || !WIDGET_TYPES.has(type))
            continue;
        const size = asSize(w['size']);
        const requires = typeof w['requires'] === 'string' && w['requires'] !== ''
            ? w['requires']
            : undefined;
        const title = asText(w['title']);
        const text = asText(w['text']);
        switch (type) {
            case 'hero':
                if (title === '')
                    continue;
                out.push({
                    type, size, requires, title,
                    subtitle: asText(w['subtitle']) || undefined,
                    links: asItems(w['links']),
                });
                break;
            case 'heading':
            case 'text':
                if (text === '')
                    continue;
                out.push({ type, size, requires, text });
                break;
            case 'note':
                if (text === '')
                    continue;
                out.push({
                    type, size, requires, text,
                    tone: w['tone'] === 'warn' ? 'warn' : 'info',
                });
                break;
            case 'divider':
                out.push({ type, size, requires });
                break;
            case 'rows':
            case 'pills':
            case 'cards':
                out.push({
                    type, size, requires,
                    title: title || undefined,
                    items: asItems(w['items']),
                });
                break;
        }
    }
    return out;
}
export function visibleWidgets(widgets: ConfiguredWidget[], allows: (code: string) => boolean): HomeWidget[] {
    const itemVisible = (i: HomeLinkItem) => i.requires === undefined || allows(i.requires);
    return widgets
        .filter((w) => w.requires === undefined || allows(w.requires))
        .map(({ requires: _requires, ...w }) => {
        if (w.type === 'hero') {
            return { ...w, links: w.links.filter(itemVisible) } as HomeWidget;
        }
        if (w.type === 'rows' || w.type === 'pills' || w.type === 'cards') {
            return { ...w, items: w.items.filter(itemVisible) } as HomeWidget;
        }
        return w as HomeWidget;
    });
}
