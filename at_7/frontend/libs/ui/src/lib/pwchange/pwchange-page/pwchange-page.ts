import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { contrastTextColor } from '../../shared/color';
import { PasswordPolicy, checkPasswordPolicy } from '../pwchange-policy';
export interface PwchangeTargetCard {
    id: number;
    connectionName: string;
    color?: string;
    consented: boolean;
    locked: boolean;
    lockRemainingSec?: number;
    maxFailures: number;
    lockMinutes: number;
    policy: PasswordPolicy;
}
export interface PwchangeLookup {
    matched: number;
    name?: string;
}
export interface PwchangeSubmit {
    currentPassword: string;
    newPassword: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-pwchange-page',
    imports: [MatIcon, TranslocoPipe],
    templateUrl: './pwchange-page.html',
    styleUrl: './pwchange-page.css',
})
export class PwchangePage {
    readonly employeeNo = input<string | undefined>(undefined);
    readonly identity = input<string[]>([]);
    readonly targets = input<PwchangeTargetCard[]>([]);
    readonly loading = input(false);
    readonly selectedId = input<number | null>(null);
    readonly lookup = input<PwchangeLookup | null>(null);
    readonly busy = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly done = input(false);
    readonly targetSelected = output<number>();
    readonly consentClicked = output<void>();
    readonly changeSubmitted = output<PwchangeSubmit>();
    readonly backClicked = output<void>();
    protected readonly current = signal('');
    protected readonly next = signal('');
    protected readonly confirm = signal('');
    protected readonly showPw = signal(false);
    protected readonly contrastTextColor = contrastTextColor;
    protected readonly selected = computed(() => this.targets().find((t) => t.id === this.selectedId()) ?? null);
    protected readonly step = computed(() => {
        if (this.done())
            return 4;
        const t = this.selected();
        if (!t)
            return 1;
        return t.consented ? 3 : 2;
    });
    protected readonly checks = computed(() => {
        const t = this.selected();
        if (!t)
            return [];
        const ident = [this.employeeNo() ?? '', ...this.identity()].filter((s) => s !== '');
        return checkPasswordPolicy(t.policy, this.next(), this.current(), this.confirm(), ident);
    });
    protected readonly canSubmit = computed(() => this.current() !== '' && this.checks().length > 0 && this.checks().every((c) => c.ok) && !this.busy());
    constructor() {
        effect(() => {
            this.selectedId();
            this.current.set('');
            this.next.set('');
            this.confirm.set('');
            this.showPw.set(false);
        });
    }
    protected select(t: PwchangeTargetCard): void {
        if (t.locked)
            return;
        this.targetSelected.emit(t.id);
    }
    protected submit(): void {
        if (!this.canSubmit())
            return;
        this.changeSubmitted.emit({ currentPassword: this.current(), newPassword: this.next() });
    }
    protected restart(): void {
        this.current.set('');
        this.next.set('');
        this.confirm.set('');
        this.backClicked.emit();
    }
    protected lockMinutesLeft(t: PwchangeTargetCard): number {
        return Math.max(1, Math.ceil((t.lockRemainingSec ?? 0) / 60));
    }
}
