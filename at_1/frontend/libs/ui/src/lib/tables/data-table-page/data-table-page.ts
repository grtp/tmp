import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, TemplateRef, computed, effect, inject, input, output, signal, viewChild, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FilterBar } from '../../shared/filter-bar/filter-bar';
import { FilterColumn, FilterPredicate, } from '../../shared/filter-bar/filter-model';
import { TmOverflowTitleDirective } from '../../shared/overflow-title/overflow-title.directive';
import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';
export type TableRow = Record<string, string | number>;
export interface CellContext {
    $implicit: TableRow;
    col: ColumnDef;
}
export interface ColumnDef {
    key: string;
    label: string;
    width?: string;
    mono?: boolean;
    align?: 'left' | 'right';
    sortable?: boolean;
    template?: TemplateRef<CellContext>;
    meta?: unknown;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-data-table-page',
    imports: [
        FilterBar,
        MatIcon,
        NgTemplateOutlet,
        TranslocoPipe,
        TmOverflowTitleDirective,
        TmResizeColumnsDirective,
    ],
    templateUrl: './data-table-page.html',
    styleUrl: './data-table-page.css',
})
export class DataTablePage {
    readonly tableNames = input<string[]>([]);
    readonly selectedTable = input('');
    readonly columns = input<ColumnDef[]>([]);
    readonly rows = input<TableRow[]>([]);
    readonly pendingRows = input<TableRow[]>([]);
    readonly totalCount = input(0);
    readonly page = input(1);
    readonly pageSize = input(50);
    readonly loading = input(false);
    readonly canCreate = input(true);
    readonly insertBlockedColumns = input<string[]>([]);
    readonly storageKey = input('');
    readonly filterColumns = input<FilterColumn[]>([]);
    readonly predicates = input<FilterPredicate[]>([]);
    readonly showMultiSelect = input(false);
    readonly showCsvExport = input(true);
    readonly expandedIndex = input(-1);
    readonly expandTemplate = input<TemplateRef<{
        $implicit: TableRow;
    }> | null>(null);
    readonly sortKey = input<string | null>(null);
    readonly sortDir = input<'asc' | 'desc'>('asc');
    readonly predicatesChange = output<FilterPredicate[]>();
    readonly tableChanged = output<string>();
    readonly createClicked = output<void>();
    readonly rowSelected = output<TableRow>();
    readonly bulkDeleteClicked = output<TableRow[]>();
    readonly savePendingClicked = output<TableRow[]>();
    readonly csvExportClicked = output<TableRow[]>();
    readonly csvFileSelected = output<File>();
    readonly pageChanged = output<number>();
    readonly pageSizeChanged = output<number>();
    readonly sortChanged = output<{
        key: string;
        dir: 'asc' | 'desc';
    }>();
    readonly sortCleared = output<void>();
    protected readonly PAGE_SIZES = [10, 20, 50, 100, 500, 1000];
    private readonly filterBar = viewChild(FilterBar);
    protected readonly filterPopOpen = signal(false);
    protected onFilterButton(e: Event): void {
        e.stopPropagation();
        this.filterBar()?.openPicker(e.currentTarget as HTMLElement);
    }
    protected onFilterOpenChanged(open: boolean): void {
        this.filterPopOpen.set(open);
        if (open)
            this.sortPop.set(null);
    }
    protected readonly sortableColumns = computed(() => this.columns().filter((c) => c.sortable));
    protected readonly sortPop = signal<{
        left: number;
        top: number;
    } | null>(null);
    protected readonly sortSearch = signal('');
    protected readonly filteredSortColumns = computed(() => {
        const f = this.sortSearch().trim().toLowerCase();
        const cols = this.sortableColumns();
        return f ? cols.filter((c) => c.label.toLowerCase().includes(f)) : cols;
    });
    protected readonly sortChipLabel = computed(() => {
        const key = this.sortKey();
        if (key === null)
            return '';
        const label = this.columns().find((c) => c.key === key)?.label ?? key;
        return `${label} ${this.sortDir() === 'asc' ? '↑' : '↓'}`;
    });
    private readonly SORT_POPOVER_WIDTH = 208;
    private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly sortPopoverEl = viewChild<ElementRef<HTMLElement>>('sortPopoverEl');
    private sortAnchorPos(el: HTMLElement): {
        left: number;
        top: number;
    } {
        const r = el.getBoundingClientRect();
        const panel = this.hostEl.nativeElement.querySelector<HTMLElement>('.panel');
        const pr = panel?.getBoundingClientRect();
        const min = Math.max(8, (pr?.left ?? 0) + 4);
        const max = Math.max(min, (pr?.right ?? window.innerWidth) - this.SORT_POPOVER_WIDTH - 4);
        const want = r.left + r.width / 2 - this.SORT_POPOVER_WIDTH / 2;
        return { left: Math.max(min, Math.min(want, max)), top: r.bottom + 4 };
    }
    protected openSortPicker(e: Event): void {
        e.stopPropagation();
        this.filterBar()?.close();
        this.sortSearch.set('');
        this.sortPop.set(this.sortAnchorPos(e.currentTarget as HTMLElement));
    }
    protected onSortColumnPicked(col: ColumnDef): void {
        const dir: 'asc' | 'desc' = this.sortKey() === col.key && this.sortDir() === 'asc' ? 'desc' : 'asc';
        this.sortChanged.emit({ key: col.key, dir });
        this.sortPop.set(null);
    }
    protected clearSort(e: Event): void {
        e.stopPropagation();
        this.sortCleared.emit();
        this.sortPop.set(null);
    }
    @HostListener('document:click', ['$event'])
    protected onDocumentClickForSort(e: MouseEvent): void {
        if (!this.sortPop())
            return;
        const target = e.target as Node;
        if (!this.sortPopoverEl()?.nativeElement.contains(target)) {
            this.sortPop.set(null);
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscapeForSort(): void {
        if (this.sortPop())
            this.sortPop.set(null);
    }
    protected readonly selected = signal<ReadonlySet<number>>(new Set());
    protected readonly multiSelectMode = signal(false);
    constructor() {
        effect(() => {
            void this.rows();
            void this.pendingRows();
            this.selected.set(new Set());
        });
    }
    protected readonly allRows = computed<TableRow[]>(() => [
        ...this.pendingRows(),
        ...this.rows(),
    ]);
    protected isPending(index: number): boolean {
        return index < this.pendingRows().length;
    }
    protected readonly selectedCount = computed(() => this.selected().size);
    protected readonly selectedPendingCount = computed(() => {
        const n = this.pendingRows().length;
        let count = 0;
        for (const i of this.selected())
            if (i < n)
                count++;
        return count;
    });
    protected readonly allChecked = computed(() => this.allRows().length > 0 &&
        this.selected().size === this.allRows().length);
    protected readonly colspan = computed(() => this.columns().length);
    protected toggleMultiSelect(): void {
        const next = !this.multiSelectMode();
        this.multiSelectMode.set(next);
        if (!next)
            this.selected.set(new Set());
    }
    protected toggleSelectAll(): void {
        this.toggleAll(!this.allChecked());
    }
    protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));
    protected readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));
    protected readonly rangeParams = computed(() => {
        const total = this.totalCount();
        const start = (this.page() - 1) * this.pageSize() + 1;
        const end = Math.min(this.page() * this.pageSize(), total);
        return {
            start: start.toLocaleString('en-US'),
            end: end.toLocaleString('en-US'),
            total: total.toLocaleString('en-US'),
        };
    });
    protected toggleRow(index: number, checked: boolean): void {
        this.selected.update((cur) => {
            const next = new Set(cur);
            if (checked)
                next.add(index);
            else
                next.delete(index);
            return next;
        });
    }
    protected toggleAll(checked: boolean): void {
        this.selected.set(checked ? new Set(this.allRows().map((_, i) => i)) : new Set());
    }
    protected onBulkDelete(): void {
        const rows = this.allRows().filter((_, i) => this.selected().has(i));
        if (rows.length > 0)
            this.bulkDeleteClicked.emit(rows);
    }
    protected onSavePending(): void {
        const rows = this.pendingRows().filter((_, i) => this.selected().has(i));
        if (rows.length > 0)
            this.savePendingClicked.emit(rows);
    }
    protected onCsvExport(): void {
        this.csvExportClicked.emit(this.allRows().filter((_, i) => this.selected().has(i)));
    }
    private dragAnchor: number | null = null;
    private dragActive = false;
    private suppressClick = false;
    private dragBase: ReadonlySet<number> = new Set();
    private dragMode: 'add' | 'remove' = 'add';
    protected onRowPointerDown(index: number, e: PointerEvent): void {
        if (!this.multiSelectMode() || e.button !== 0)
            return;
        this.dragAnchor = index;
        this.dragActive = false;
        this.dragBase = this.selected();
        this.dragMode = this.dragBase.has(index) ? 'remove' : 'add';
    }
    protected onRowPointerEnter(index: number): void {
        if (this.dragAnchor === null)
            return;
        if (!this.dragActive && index === this.dragAnchor)
            return;
        this.dragActive = true;
        const a = this.dragAnchor;
        const [from, to] = a <= index ? [a, index] : [index, a];
        const next = new Set(this.dragBase);
        for (let i = from; i <= to; i++) {
            if (this.dragMode === 'add')
                next.add(i);
            else
                next.delete(i);
        }
        this.selected.set(next);
    }
    @HostListener('document:pointerup')
    protected onPointerUp(): void {
        if (this.dragActive) {
            this.suppressClick = true;
            setTimeout(() => (this.suppressClick = false), 0);
        }
        this.dragAnchor = null;
        this.dragActive = false;
    }
    protected onRowClick(index: number, row: TableRow): void {
        if (this.suppressClick) {
            this.suppressClick = false;
            return;
        }
        if (this.multiSelectMode()) {
            this.toggleRow(index, !this.selected().has(index));
            return;
        }
        if (this.isPending(index))
            return;
        this.rowSelected.emit(row);
    }
    protected onCsvFileSelected(input: HTMLInputElement): void {
        const file = input.files?.[0];
        input.value = '';
        if (file)
            this.csvFileSelected.emit(file);
    }
    protected readonly csvDragActive = signal(false);
    private csvDragDepth = 0;
    private canDropCsv(): boolean {
        return this.canCreate() && this.insertBlockedColumns().length === 0;
    }
    private hasFiles(e: DragEvent): boolean {
        return !!e.dataTransfer && e.dataTransfer.types.includes('Files');
    }
    protected onDragEnter(e: DragEvent): void {
        if (!this.canDropCsv() || !this.hasFiles(e))
            return;
        e.preventDefault();
        this.csvDragDepth++;
        this.csvDragActive.set(true);
    }
    protected onDragOver(e: DragEvent): void {
        if (!this.canDropCsv() || !this.hasFiles(e))
            return;
        e.preventDefault();
        if (e.dataTransfer)
            e.dataTransfer.dropEffect = 'copy';
    }
    protected onDragLeave(): void {
        if (this.csvDragDepth === 0)
            return;
        this.csvDragDepth--;
        if (this.csvDragDepth === 0)
            this.csvDragActive.set(false);
    }
    protected onDrop(e: DragEvent): void {
        e.preventDefault();
        this.csvDragDepth = 0;
        this.csvDragActive.set(false);
        if (!this.canDropCsv())
            return;
        const file = e.dataTransfer?.files?.[0];
        if (file && (/\.csv$/i.test(file.name) || file.type === 'text/csv')) {
            this.csvFileSelected.emit(file);
        }
    }
    @HostListener('document:dragover', ['$event'])
    @HostListener('document:drop', ['$event'])
    protected preventDocumentDrop(e: DragEvent): void {
        if (this.hasFiles(e))
            e.preventDefault();
    }
}
