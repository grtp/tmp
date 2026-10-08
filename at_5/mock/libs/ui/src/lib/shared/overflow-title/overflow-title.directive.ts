import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';
@Directive({
    selector: '[tmOverflowTitle]',
})
export class TmOverflowTitleDirective {
    readonly tmOverflowTitle = input<string | number | null | undefined>('');
    private el = inject<ElementRef<HTMLElement>>(ElementRef);
    @HostListener('mouseenter')
    protected onEnter(): void {
        const value = this.tmOverflowTitle();
        if (value === null || value === undefined)
            return;
        const host = this.el.nativeElement;
        const text = String(value);
        if (host.scrollWidth > host.clientWidth) {
            host.title = text;
        }
        else if (host.title === text) {
            host.removeAttribute('title');
        }
    }
}
