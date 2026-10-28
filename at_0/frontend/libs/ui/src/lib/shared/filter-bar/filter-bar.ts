import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FilterColumn, FilterDraft, FilterPredicate, chipText, defaultDraft, draftFromPredicate, draftToPredicate, opAllowsMultiValues, opsFor, } from './filter-model';
interface PopoverState {
    mode: 'column' | 'edit';
    left: number;
    top: number;
    columnKey?: string;
    editIndex: number;
}
const POPOVER_WIDTH = 260;
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-filter-bar',
    imports: [MatIcon, TranslocoPipe],
    templateUrl: './filter-bar.html',
    styleUrl: './filter-bar.css',
})
export class FilterBar {
    private transloco = inject(TranslocoService);
    private host = inject<ElementRef<HTMLElement>>(ElementRef);
    readonly columns = input<FilterColumn[]>([]);
    readonly predicates = input<FilterPredicate[]>([]);
    readonly predicatesChange = output<FilterPredicate[]>();
    readonly openChanged = output<boolean>();
    protected readonly pop = signal<PopoverState | null>(null);
    protected readonly colSearch = signal('');
    protected readonly draft = signal<FilterDraft>({
        op: 'contains',
        v1: '',
        v2: '',
        negate: false,
    });
    protected readonly invalid = signal(false);
    protected readonly filteredColumns = computed(() => {
        const f = this.colSearch().trim().toLowerCase();
        if (!f)
            return this.columns();
        return this.columns().filter((c) => c.label.toLowerCase().includes(f));
    });
    protected readonly editColumn = computed<FilterColumn | null>(() => {
        const key = this.pop()?.columnKey;
        return this.columns().find((c) => c.key === key) ?? null;
    });
    protected readonly editOps = computed(() => {
        const col = this.editColumn();
        return col ? opsFor(col.type) : [];
    });
    protected readonly showMultiHint = computed(() => {
        const col = this.editColumn();
        return (!!col &&
            opAllowsMultiValues(this.draft().op) &&
            col.type !== 'bool' &&
            col.type !== 'enum');
    });
    protected typeKey(t: string): string {
        return 'filterBar.type' + t.charAt(0).toUpperCase() + t.slice(1);
    }
    protected opKey(op: string): string {
        return 'filterBar.op' + op.charAt(0).toUpperCase() + op.slice(1);
    }
    protected chipTextOf(p: FilterPredicate): string {
        const col = this.columns().find((c) => c.key === p.column);
        if (!col)
            return p.column;
        return chipText(col, p, this.transloco.translate('filterBar.negateSuffix'));
    }
    private setPop(next: PopoverState | null): void {
        const wasOpen = this.pop() !== null;
        this.pop.set(next);
        const isOpen = next !== null;
        if (wasOpen !== isOpen)
            this.openChanged.emit(isOpen);
    }
    private anchorPos(el: HTMLElement | null, center = false): {
        left: number;
        top: number;
    } {
        const r = el?.getBoundingClientRect();
        if (!r)
            return { left: 8, top: 8 };
        const panel = this.host.nativeElement.closest('.panel');
        const pr = panel?.getBoundingClientRect();
        const min = Math.max(8, (pr?.left ?? 0) + 4);
        const max = Math.max(min, (pr?.right ?? window.innerWidth) - POPOVER_WIDTH - 4);
        const want = center ? r.left + r.width / 2 - POPOVER_WIDTH / 2 : r.left;
        return {
            left: Math.max(min, Math.min(want, max)),
            top: r.bottom + 4,
        };
    }
    openPicker(anchor?: HTMLElement): void {
        this.colSearch.set('');
        const el = anchor ?? this.host.nativeElement.querySelector<HTMLElement>('.add');
        this.setPop({ mode: 'column', ...this.anchorPos(el, true), editIndex: -1 });
    }
    protected openColumnPicker(e: Event): void {
        this.colSearch.set('');
        this.setPop({
            mode: 'column',
            ...this.anchorPos(e.currentTarget as HTMLElement),
            editIndex: -1,
        });
    }
    protected pickColumn(key: string): void {
        const cur = this.pop();
        const col = this.columns().find((c) => c.key === key);
        if (!cur || !col)
            return;
        this.draft.set(defaultDraft(col));
        this.invalid.set(false);
        this.setPop({ ...cur, mode: 'edit', columnKey: key });
    }
    protected openEdit(index: number, e: Event): void {
        const p = this.predicates()[index];
        if (!p)
            return;
        this.draft.set(draftFromPredicate(p));
        this.invalid.set(false);
        this.setPop({
            mode: 'edit',
            ...this.anchorPos(e.currentTarget as HTMLElement),
            columnKey: p.column,
            editIndex: index,
        });
    }
    protected setDraft(patch: Partial<FilterDraft>): void {
        this.draft.update((d) => ({ ...d, ...patch }));
        this.invalid.set(false);
    }
    protected apply(): void {
        const cur = this.pop();
        const col = this.editColumn();
        if (!cur || !col)
            return;
        const pred = draftToPredicate(col, this.draft());
        if (!pred) {
            this.invalid.set(true);
            return;
        }
        const next = [...this.predicates()];
        if (cur.editIndex >= 0) {
            next[cur.editIndex] = pred;
        }
        else {
            next.push(pred);
        }
        this.setPop(null);
        this.predicatesChange.emit(next);
    }
    protected remove(index: number): void {
        this.setPop(null);
        this.predicatesChange.emit(this.predicates().filter((_, i) => i !== index));
    }
    protected clearAll(): void {
        this.setPop(null);
        this.predicatesChange.emit([]);
    }
    close(): void {
        this.setPop(null);
    }
    @HostListener('document:click', ['$event'])
    protected onDocumentClick(e: Event): void {
        if (!this.pop())
            return;
        const target = e.target as Node | null;
        if (target && !this.host.nativeElement.contains(target)) {
            this.setPop(null);
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.setPop(null);
    }
}
