import { MatIcon } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal, } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-user-menu',
    imports: [MatIcon, TranslocoPipe],
    templateUrl: './user-menu.html',
    styleUrl: './user-menu.css',
})
export class UserMenu {
    private host = inject(ElementRef<HTMLElement>);
    readonly userName = input('');
    readonly topClicked = output<void>();
    readonly personalSettingsClicked = output<void>();
    readonly logoutClicked = output<void>();
    protected readonly open = signal(false);
    protected onTop(): void {
        this.open.set(false);
        this.topClicked.emit();
    }
    protected onPersonalSettings(): void {
        this.open.set(false);
        this.personalSettingsClicked.emit();
    }
    protected onLogout(): void {
        this.open.set(false);
        this.logoutClicked.emit();
    }
    @HostListener('document:click', ['$event'])
    protected onDocumentClick(e: MouseEvent): void {
        if (this.open() && !this.host.nativeElement.contains(e.target as Node)) {
            this.open.set(false);
        }
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        if (this.open())
            this.open.set(false);
    }
}
