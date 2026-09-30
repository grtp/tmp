import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, } from '@angular/core';
const MIN_COL_WIDTH = 60;
const HANDLE_MARK = 'data-tm-resize-handle';
const FILLER_MARK = 'data-tm-filler';
const LOADING_MARK = 'data-tm-loading';
const AUTOFIT_MIN = 90;
const AUTOFIT_MAX = 480;
@Directive({
    selector: 'table[tmResizeColumns]',
})
export class TmResizeColumnsDirective implements AfterViewInit, OnDestroy {
    readonly tmResizeColumns = input<string>('');
    readonly tmAutoFit = input(false);
    private el = inject(ElementRef<HTMLTableElement>);
    private observer: MutationObserver | null = null;
    private widths: Record<string, number> = {};
    private loadedKey: string | null = null;
    private rebuildScheduled = false;
    private fitSignature = '';
    ngAfterViewInit(): void {
        this.rebuild();
        this.observer = new MutationObserver(() => this.scheduleRebuild());
        const thead = this.el.nativeElement.querySelector('thead');
        if (thead) {
            this.observer.observe(thead, { childList: true, subtree: true });
        }
        const tbody = this.el.nativeElement.querySelector('tbody');
        if (this.tmAutoFit() && tbody) {
            this.observer.observe(tbody, { childList: true });
        }
    }
    ngOnDestroy(): void {
        this.observer?.disconnect();
    }
    private scheduleRebuild(): void {
        if (this.rebuildScheduled)
            return;
        this.rebuildScheduled = true;
        requestAnimationFrame(() => {
            this.rebuildScheduled = false;
            this.rebuild();
        });
    }
    private headerCells(): HTMLTableCellElement[] {
        const row = this.el.nativeElement.querySelector('thead tr');
        if (!row)
            return [];
        return (Array.from(row.children) as HTMLTableCellElement[]).filter((th) => !th.hasAttribute(FILLER_MARK));
    }
    private keyOf(th: HTMLTableCellElement, index: number): string {
        return th.dataset['col'] ?? String(index);
    }
    private rebuild(): void {
        const table = this.el.nativeElement;
        const ths = this.headerCells();
        if (ths.length === 0)
            return;
        const storageKey = this.tmResizeColumns();
        if (storageKey !== this.loadedKey) {
            this.widths = storageKey ? loadWidths(storageKey) : {};
            this.loadedKey = storageKey;
        }
        table.style.tableLayout = 'fixed';
        const useFiller = this.tmAutoFit();
        let colgroup = table.querySelector(':scope > colgroup');
        if (!colgroup) {
            colgroup = document.createElement('colgroup');
            table.insertBefore(colgroup, table.firstChild);
        }
        const colgroupEl = colgroup;
        let fillerCol = colgroupEl.querySelector(`col[${FILLER_MARK}]`) as HTMLTableColElement | null;
        if (fillerCol && !useFiller) {
            fillerCol.remove();
            fillerCol = null;
        }
        const realCols = () => (Array.from(colgroupEl.children) as HTMLTableColElement[]).filter((c) => !c.hasAttribute(FILLER_MARK));
        while (realCols().length < ths.length) {
            const col = document.createElement('col');
            colgroup.insertBefore(col, fillerCol);
        }
        while (realCols().length > ths.length) {
            const cols = realCols();
            colgroup.removeChild(cols[cols.length - 1]);
        }
        if (useFiller) {
            if (!fillerCol) {
                fillerCol = document.createElement('col');
                fillerCol.setAttribute(FILLER_MARK, '1');
            }
            colgroup.appendChild(fillerCol);
            fillerCol.style.width = '';
        }
        if (useFiller) {
            this.autoFitIfNeeded(table, ths);
            this.syncFillerCells(table, ths.length);
        }
        const cols = realCols();
        ths.forEach((th, i) => {
            const col = cols[i];
            const w = this.widths[this.keyOf(th, i)];
            if (w) {
                col.style.width = `${w}px`;
            }
            if (th.hasAttribute('data-no-resize'))
                return;
            if (th.querySelector(`[${HANDLE_MARK}]`))
                return;
            if (getComputedStyle(th).position === 'static') {
                th.style.position = 'relative';
            }
            const handle = document.createElement('span');
            handle.setAttribute(HANDLE_MARK, '1');
            handle.setAttribute('aria-hidden', 'true');
            Object.assign(handle.style, {
                position: 'absolute',
                top: '0',
                right: '0',
                width: '12px',
                height: '100%',
                cursor: 'col-resize',
                zIndex: '1',
            } satisfies Partial<CSSStyleDeclaration>);
            handle.addEventListener('pointerenter', () => {
                handle.style.background =
                    'linear-gradient(to left, rgba(62,105,173,0.55) 3px, transparent 3px)';
            });
            handle.addEventListener('pointerleave', () => {
                handle.style.background = '';
            });
            handle.addEventListener('pointerdown', (e) => this.startResize(e, th));
            handle.addEventListener('dblclick', () => this.resetWidth(th));
            th.appendChild(handle);
        });
    }
    private syncFillerCells(table: HTMLTableElement, realCount: number): void {
        table.querySelectorAll(':scope > thead > tr').forEach((row) => {
            if (row.querySelector(`[${FILLER_MARK}]`))
                return;
            const ref = row.lastElementChild;
            if (!ref)
                return;
            row.appendChild(makeFillerCell(ref));
        });
        table.querySelectorAll(':scope > tbody > tr').forEach((row) => {
            if (row.querySelector(`[${FILLER_MARK}]`))
                return;
            const cells = Array.from(row.children) as HTMLTableCellElement[];
            if (cells.length !== realCount)
                return;
            if (cells.some((c) => c.hasAttribute('colspan')))
                return;
            row.appendChild(makeFillerCell(cells[cells.length - 1]));
        });
    }
    private autoFitIfNeeded(table: HTMLTableElement, ths: HTMLTableCellElement[]): void {
        const tbody = table.querySelector('tbody');
        if (tbody?.querySelector(`[${LOADING_MARK}]`))
            return;
        const hasData = !!tbody?.querySelector('td:not([colspan])');
        const sig = ths.map((th, i) => this.keyOf(th, i)).join(',') +
            '|' +
            (hasData ? 'd' : 'e');
        if (sig === this.fitSignature)
            return;
        this.fitSignature = sig;
        const colgroup = table.querySelector(':scope > colgroup');
        if (!colgroup)
            return;
        const colEls = (Array.from(colgroup.children) as HTMLTableColElement[]).filter((c) => !c.hasAttribute(FILLER_MARK));
        const prevLayout = table.style.tableLayout;
        const prevWidth = table.style.width;
        const prevCols = colEls.map((c) => c.style.width);
        table.style.tableLayout = 'auto';
        table.style.width = 'auto';
        colEls.forEach((c) => (c.style.width = ''));
        const measured = ths.map((th) => Math.min(AUTOFIT_MAX, Math.max(AUTOFIT_MIN, Math.ceil(th.getBoundingClientRect().width) + 2)));
        table.style.tableLayout = prevLayout || 'fixed';
        table.style.width = prevWidth;
        colEls.forEach((c, i) => (c.style.width = prevCols[i]));
        ths.forEach((th, i) => {
            if (th.hasAttribute('data-no-resize'))
                return;
            const saved = this.widths[this.keyOf(th, i)];
            colEls[i].style.width = `${saved ?? measured[i]}px`;
        });
    }
    private startResize(e: PointerEvent, th: HTMLTableCellElement): void {
        e.preventDefault();
        e.stopPropagation();
        const table = this.el.nativeElement;
        const ths = this.headerCells();
        const colgroup = table.querySelector(':scope > colgroup');
        const cols = colgroup
            ? (Array.from(colgroup.children) as HTMLTableColElement[]).filter((c) => !c.hasAttribute(FILLER_MARK))
            : [];
        const index = ths.indexOf(th);
        const col = cols[index];
        if (index < 0 || !col)
            return;
        const rightTh = this.tmAutoFit() ? undefined : ths[index + 1];
        const rightCol = this.tmAutoFit() ? undefined : cols[index + 1];
        const pair = !!rightTh && !!rightCol && !rightTh.hasAttribute('data-no-resize');
        const startX = e.clientX;
        const startLeft = th.getBoundingClientRect().left;
        const startWidth = th.getBoundingClientRect().width;
        const rightStart = pair ? rightTh.getBoundingClientRect().width : 0;
        if (!col.style.width)
            col.style.width = `${Math.round(startWidth)}px`;
        if (pair && rightCol && !rightCol.style.width) {
            rightCol.style.width = `${Math.round(rightStart)}px`;
        }
        const prevUserSelect = table.style.userSelect;
        table.style.userSelect = 'none';
        const guide = createGuideLine(table, e.clientX);
        const move = (ev: PointerEvent) => {
            let delta = Math.round(ev.clientX - startX);
            delta = Math.max(MIN_COL_WIDTH - startWidth, delta);
            if (pair)
                delta = Math.min(delta, rightStart - MIN_COL_WIDTH);
            const w = Math.round(startWidth + delta);
            col.style.width = `${w}px`;
            this.widths[this.keyOf(th, index)] = w;
            if (pair && rightTh && rightCol) {
                const rw = Math.round(rightStart - delta);
                rightCol.style.width = `${rw}px`;
                this.widths[this.keyOf(rightTh, index + 1)] = rw;
            }
            guide.style.left = `${startLeft + w}px`;
        };
        const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            table.style.userSelect = prevUserSelect;
            guide.remove();
            this.persist();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    }
    private resetWidth(th: HTMLTableCellElement): void {
        const ths = this.headerCells();
        const index = ths.indexOf(th);
        const colgroup = this.el.nativeElement.querySelector(':scope > colgroup');
        const cols = colgroup
            ? (Array.from(colgroup.children) as HTMLTableColElement[]).filter((c) => !c.hasAttribute(FILLER_MARK))
            : [];
        const col = cols[index];
        if (index < 0 || !col)
            return;
        delete this.widths[this.keyOf(th, index)];
        col.style.width = '';
        this.persist();
        if (this.tmAutoFit()) {
            this.fitSignature = '';
            this.scheduleRebuild();
        }
    }
    private persist(): void {
        const key = this.tmResizeColumns();
        if (!key)
            return;
        try {
            if (Object.keys(this.widths).length === 0) {
                localStorage.removeItem(key);
            }
            else {
                localStorage.setItem(key, JSON.stringify(this.widths));
            }
        }
        catch {
        }
    }
}
function makeFillerCell(ref: Element): HTMLElement {
    const cell = ref.cloneNode(false) as HTMLElement;
    cell.removeAttribute('data-col');
    cell.removeAttribute('data-no-resize');
    cell.removeAttribute('colspan');
    cell.removeAttribute('title');
    cell.className = ref.className;
    cell.classList.remove('check-th', 'check-td');
    cell.style.width = '';
    cell.setAttribute(FILLER_MARK, '1');
    cell.setAttribute('data-no-resize', '1');
    cell.setAttribute('aria-hidden', 'true');
    return cell;
}
function createGuideLine(table: HTMLTableElement, x: number): HTMLDivElement {
    const rect = (table.parentElement ?? table).getBoundingClientRect();
    const guide = document.createElement('div');
    Object.assign(guide.style, {
        position: 'fixed',
        top: `${rect.top}px`,
        height: `${rect.height}px`,
        left: `${x}px`,
        width: '2px',
        background: 'rgba(62, 105, 173, 0.7)',
        zIndex: '60',
        pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(guide);
    return guide;
}
function loadWidths(key: string): Record<string, number> {
    try {
        const raw = localStorage.getItem(key);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'number' && v >= MIN_COL_WIDTH)
                out[k] = v;
        }
        return out;
    }
    catch {
        return {};
    }
}
