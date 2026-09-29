import { Injectable, computed, inject, signal } from '@angular/core';
import { MeApi } from './api/me-api';
import { UserSettings } from './models';
const DEFAULTS: UserSettings = { headerClock: 'minute', headerClockFormat: '' };
@Injectable({ providedIn: 'root' })
export class UserSettingsService {
    private api = inject(MeApi);
    private readonly state = signal<UserSettings>(DEFAULTS);
    readonly settings = computed(() => this.state());
    readonly headerClock = computed(() => this.state().headerClock);
    readonly headerClockFormat = computed(() => this.state().headerClockFormat);
    async load(): Promise<void> {
        try {
            this.state.set(await this.api.getMySettings());
        }
        catch {
        }
    }
    reset(): void {
        this.state.set(DEFAULTS);
    }
    async update(patch: Partial<UserSettings>): Promise<void> {
        const before = this.state();
        this.state.set({ ...before, ...patch });
        try {
            this.state.set(await this.api.updateMySettings(patch));
        }
        catch (err) {
            this.state.set(before);
            throw err;
        }
    }
}
