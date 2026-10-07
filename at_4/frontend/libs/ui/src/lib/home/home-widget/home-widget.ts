import { ChangeDetectionStrategy, Component, computed, input, output, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
export type HomeWidgetSize = 1 | 2 | 3;
export interface HomeLinkItem {
    label: string;
    url: string;
    icon?: string;
    desc?: string;
    requires?: string;
}
export type HomeWidget = {
    type: 'hero';
    size: HomeWidgetSize;
    title: string;
    subtitle?: string;
    links: HomeLinkItem[];
} | {
    type: 'heading';
    size: HomeWidgetSize;
    text: string;
} | {
    type: 'text';
    size: HomeWidgetSize;
    text: string;
} | {
    type: 'note';
    size: HomeWidgetSize;
    tone: 'info' | 'warn';
    text: string;
} | {
    type: 'divider';
    size: HomeWidgetSize;
} | {
    type: 'rows';
    size: HomeWidgetSize;
    title?: string;
    items: HomeLinkItem[];
} | {
    type: 'pills';
    size: HomeWidgetSize;
    title?: string;
    items: HomeLinkItem[];
} | {
    type: 'cards';
    size: HomeWidgetSize;
    title?: string;
    items: HomeLinkItem[];
};
export type HomeWidgetConfig = HomeWidget & {
    requires?: string;
};
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-widget',
    imports: [MatIcon],
    templateUrl: './home-widget.html',
    styleUrl: './home-widget.css',
})
export class HomeWidgetView {
    readonly widget = input.required<HomeWidget>();
    readonly linkOpened = output<string>();
    private narrowed<T extends HomeWidget['type']>(type: T) {
        return computed(() => {
            const w = this.widget();
            return w.type === type ? (w as Extract<HomeWidget, {
                type: T;
            }>) : null;
        });
    }
    protected readonly hero = this.narrowed('hero');
    protected readonly heading = this.narrowed('heading');
    protected readonly plainText = this.narrowed('text');
    protected readonly note = this.narrowed('note');
    protected readonly divider = this.narrowed('divider');
    protected readonly rows = this.narrowed('rows');
    protected readonly pills = this.narrowed('pills');
    protected readonly cards = this.narrowed('cards');
    protected isExternal(url: string): boolean {
        return !url.startsWith('/');
    }
}
