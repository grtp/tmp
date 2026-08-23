import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray, } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HomePage } from '../home-page/home-page';
import { HomeLinkItem, HomeWidget, HomeWidgetConfig, HomeWidgetSize, HomeWidgetView, } from '../home-widget/home-widget';
export interface RequiresOption {
    code: string;
    label: string;
}
interface PaletteEntry {
    type: HomeWidgetConfig['type'];
    icon: string;
}
const PALETTE: PaletteEntry[] = [
    { type: 'hero', icon: 'wallpaper' },
    { type: 'heading', icon: 'title' },
    { type: 'text', icon: 'notes' },
    { type: 'note', icon: 'info' },
    { type: 'divider', icon: 'horizontal_rule' },
    { type: 'rows', icon: 'view_list' },
    { type: 'pills', icon: 'label' },
    { type: 'cards', icon: 'grid_view' },
];
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-builder',
    imports: [
        CdkDrag,
        CdkDragHandle,
        CdkDropList,
        HomePage,
        HomeWidgetView,
        MatIcon,
        TranslocoPipe,
    ],
    templateUrl: './home-builder.html',
    styleUrl: './home-builder.css',
})
export class HomeBuilder {
    private transloco = inject(TranslocoService);
    readonly widgets = input<HomeWidgetConfig[]>([]);
    readonly previewWidgets = input<HomeWidget[]>([]);
    readonly requiresOptions = input<RequiresOption[]>([]);
    readonly saving = input(false);
    readonly dirty = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly jsonError = input<string | null>(null);
    readonly widgetsChanged = output<HomeWidgetConfig[]>();
    readonly saveClicked = output<void>();
    readonly resetClicked = output<void>();
    readonly jsonApplied = output<string>();
    protected readonly palette = PALETTE;
    protected readonly selected = signal<number | null>(null);
    protected readonly jsonOpen = signal(false);
    protected readonly jsonDraft = signal('');
    protected readonly previewOpen = signal(false);
    protected readonly selectedWidget = computed<HomeWidgetConfig | null>(() => {
        const i = this.selected();
        return i === null ? null : (this.widgets()[i] ?? null);
    });
    protected add(type: HomeWidgetConfig['type']): void {
        const t = (key: string) => this.transloco.translate('homeBuilder.default.' + key);
        const item = (): HomeLinkItem => ({ label: t('itemLabel'), url: '/home' });
        let w: HomeWidgetConfig;
        switch (type) {
            case 'hero':
                w = { type, size: 3, title: t('heroTitle'), links: [] };
                break;
            case 'heading':
                w = { type, size: 3, text: t('heading') };
                break;
            case 'text':
                w = { type, size: 3, text: t('text') };
                break;
            case 'note':
                w = { type, size: 3, tone: 'info', text: t('note') };
                break;
            case 'divider':
                w = { type, size: 3 };
                break;
            case 'rows':
            case 'pills':
            case 'cards':
                w = { type, size: 3, items: [item()] };
                break;
        }
        const next = [...this.widgets(), w];
        this.selected.set(next.length - 1);
        this.widgetsChanged.emit(next);
    }
    protected select(i: number): void {
        this.selected.set(i);
    }
    protected onDrop(e: CdkDragDrop<unknown>): void {
        if (e.previousIndex === e.currentIndex)
            return;
        const next = [...this.widgets()];
        moveItemInArray(next, e.previousIndex, e.currentIndex);
        this.selected.set(e.currentIndex);
        this.widgetsChanged.emit(next);
    }
    protected move(i: number, delta: -1 | 1): void {
        const j = i + delta;
        const next = [...this.widgets()];
        if (j < 0 || j >= next.length)
            return;
        moveItemInArray(next, i, j);
        this.selected.set(j);
        this.widgetsChanged.emit(next);
    }
    protected remove(i: number): void {
        const next = this.widgets().filter((_, k) => k !== i);
        this.selected.set(null);
        this.widgetsChanged.emit(next);
    }
    protected patch(partial: Partial<HomeWidgetConfig>): void {
        const i = this.selected();
        if (i === null)
            return;
        const next = [...this.widgets()];
        next[i] = { ...next[i], ...partial } as HomeWidgetConfig;
        this.widgetsChanged.emit(next);
    }
    protected setSize(size: HomeWidgetSize): void {
        this.patch({ size });
    }
    protected setRequires(code: string): void {
        const i = this.selected();
        if (i === null)
            return;
        const next = [...this.widgets()];
        const w = { ...next[i] } as HomeWidgetConfig;
        if (code === '') {
            delete w.requires;
        }
        else {
            w.requires = code;
        }
        next[i] = w;
        this.widgetsChanged.emit(next);
    }
    protected inputValue(e: Event): string {
        return (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    }
    protected selectedItems(): HomeLinkItem[] {
        const w = this.selectedWidget();
        if (w === null)
            return [];
        if (w.type === 'hero')
            return w.links;
        if (w.type === 'rows' || w.type === 'pills' || w.type === 'cards')
            return w.items;
        return [];
    }
    protected hasItems(): boolean {
        const w = this.selectedWidget();
        return w !== null &&
            (w.type === 'hero' || w.type === 'rows' || w.type === 'pills' || w.type === 'cards');
    }
    private patchItems(items: HomeLinkItem[]): void {
        const w = this.selectedWidget();
        if (w === null)
            return;
        if (w.type === 'hero') {
            this.patch({ links: items });
        }
        else if (w.type === 'rows' || w.type === 'pills' || w.type === 'cards') {
            this.patch({ items });
        }
    }
    protected addItem(): void {
        const label = this.transloco.translate('homeBuilder.default.itemLabel');
        this.patchItems([...this.selectedItems(), { label, url: '/home' }]);
    }
    protected patchItem(k: number, partial: Partial<HomeLinkItem>): void {
        const items = [...this.selectedItems()];
        const merged = { ...items[k], ...partial };
        if (merged.icon === '')
            delete merged.icon;
        if (merged.desc === '')
            delete merged.desc;
        if (merged.requires === '')
            delete merged.requires;
        items[k] = merged;
        this.patchItems(items);
    }
    protected moveItem(k: number, delta: -1 | 1): void {
        const j = k + delta;
        const items = [...this.selectedItems()];
        if (j < 0 || j >= items.length)
            return;
        moveItemInArray(items, k, j);
        this.patchItems(items);
    }
    protected removeItem(k: number): void {
        this.patchItems(this.selectedItems().filter((_, x) => x !== k));
    }
    protected toggleJson(): void {
        if (!this.jsonOpen())
            this.refreshJson();
        this.jsonOpen.set(!this.jsonOpen());
    }
    protected refreshJson(): void {
        this.jsonDraft.set(JSON.stringify({ version: 1, widgets: this.widgets() }, null, 2));
    }
    protected applyJson(): void {
        this.selected.set(null);
        this.jsonApplied.emit(this.jsonDraft());
    }
}
