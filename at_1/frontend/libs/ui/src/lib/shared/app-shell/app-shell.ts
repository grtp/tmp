import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { formatClock } from '../clock-format';
import { LangSelect } from '../lang-select/lang-select';
import { UserMenu } from '../user-menu/user-menu';
export interface MenuItem {
    id: string;
    label: string;
    icon: string;
}
const SIDEBAR_COLLAPSED_KEY = 'ftool.sidebarCollapsed';
function loadSidebarCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    }
    catch {
        return false;
    }
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-app-shell',
    imports: [
        MatButtonModule,
        MatIcon,
        MatListModule,
        MatToolbarModule,
        TranslocoPipe,
        LangSelect,
        UserMenu,
    ],
    templateUrl: './app-shell.html',
    styleUrl: './app-shell.css',
})
export class AppShell {
    readonly systemName = input('F-tool');
    readonly userName = input('');
    readonly activeMenuId = input('home');
    readonly menuItems = input<MenuItem[]>([]);
    readonly menuSelected = output<string>();
    protected readonly sidebarCollapsed = signal(loadSidebarCollapsed());
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, {
        initialValue: this.transloco.getActiveLang(),
    });
    readonly clockMode = input<'none' | 'minute' | 'second' | 'custom'>('minute');
    readonly clockFormat = input('');
    private readonly now = signal(new Date());
    protected readonly clock = computed(() => {
        const d = this.now();
        const ja = this.lang() === 'ja';
        if (this.clockMode() === 'custom') {
            return { date: '', time: formatClock(this.clockFormat(), d, ja ? 'ja' : 'en') };
        }
        const date = new Intl.DateTimeFormat(ja ? 'ja-JP' : 'en-US', {
            year: 'numeric',
            month: ja ? '2-digit' : 'short',
            day: ja ? '2-digit' : 'numeric',
            weekday: ja ? 'short' : undefined,
        }).format(d);
        const time = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: this.clockMode() === 'second' ? '2-digit' : undefined,
            hour12: false,
        }).format(d);
        return { date, time };
    });
    private tickEverySecond(): boolean {
        if (this.clockMode() === 'second')
            return true;
        return this.clockMode() === 'custom' && this.clockFormat().includes('s');
    }
    constructor() {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const scheduleNext = (): void => {
            const step = this.tickEverySecond() ? 1000 : 60000;
            timer = setTimeout(tick, step - (Date.now() % step) + 50);
        };
        const tick = (): void => {
            this.now.set(new Date());
            scheduleNext();
        };
        effect(() => {
            this.clockMode();
            this.clockFormat();
            this.now.set(new Date());
            if (timer !== undefined)
                clearTimeout(timer);
            scheduleNext();
        });
        inject(DestroyRef).onDestroy(() => {
            if (timer !== undefined)
                clearTimeout(timer);
        });
    }
    protected toggleSidebar(): void {
        const next = !this.sidebarCollapsed();
        this.sidebarCollapsed.set(next);
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
        }
        catch {
        }
    }
}
