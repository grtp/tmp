import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal, } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { clockTokenExamples, formatClock } from '../clock-format';
export type HeaderClockMode = 'none' | 'minute' | 'second' | 'custom';
export interface PersonalSettings {
    headerClock: HeaderClockMode;
    headerClockFormat: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-personal-settings-dialog',
    imports: [MatDialogModule, MatIcon, TranslocoPipe],
    templateUrl: './personal-settings-dialog.html',
    styleUrl: './personal-settings-dialog.css',
})
export class PersonalSettingsDialog {
    private readonly dialogRef = inject<MatDialogRef<PersonalSettingsDialog>>(MatDialogRef);
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, {
        initialValue: this.transloco.getActiveLang(),
    });
    readonly settings = input<PersonalSettings>({
        headerClock: 'minute',
        headerClockFormat: '',
    });
    readonly errorMessage = input<string | null>(null);
    readonly version = input('');
    readonly clockModeChanged = output<HeaderClockMode>();
    readonly clockFormatChanged = output<string>();
    protected readonly modes: HeaderClockMode[] = ['none', 'minute', 'second', 'custom'];
    private readonly formatDraft = signal<string | null>(null);
    protected readonly format = computed(() => this.formatDraft() ?? this.settings().headerClockFormat);
    protected readonly helpOpen = signal(false);
    private locale(): 'ja' | 'en' {
        return this.lang() === 'ja' ? 'ja' : 'en';
    }
    protected readonly preview = computed(() => formatClock(this.format(), new Date(), this.locale()));
    private static readonly HELP_SAMPLE_DATE = new Date(1970, 0, 23, 14, 56, 43);
    protected readonly tokenRows = computed(() => clockTokenExamples(PersonalSettingsDialog.HELP_SAMPLE_DATE, this.locale()));
    protected readonly helpSampleLabel = computed(() => formatClock('yyyy/MM/dd HH:mm:ss', PersonalSettingsDialog.HELP_SAMPLE_DATE, this.locale()));
    protected onFormatInput(e: Event): void {
        this.formatDraft.set((e.target as HTMLInputElement).value);
    }
    protected commitFormat(): void {
        const draft = this.formatDraft();
        if (draft !== null && draft !== this.settings().headerClockFormat) {
            this.clockFormatChanged.emit(draft);
        }
    }
    protected close(): void {
        this.dialogRef.close();
    }
    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        this.close();
    }
}
