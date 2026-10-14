import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthLevel, Me } from '../models';
const LEVEL_RANK: Record<AuthLevel, number> = { user: 1, maintainer: 2, admin: 3 };
@Injectable({ providedIn: 'root' })
export class AuthService {
    private http = inject(HttpClient);
    private meState = signal<Me | null | undefined>(undefined);
    readonly me = computed(() => this.meState() ?? null);
    readonly actions = computed(() => this.me()?.actions ?? []);
    level(code: string): AuthLevel | null {
        return this.actions().find((a) => a.code === code)?.authLevel ?? null;
    }
    allows(code: string, min: AuthLevel): boolean {
        const l = this.level(code);
        return l !== null && LEVEL_RANK[l] >= LEVEL_RANK[min];
    }
    async ensureLoaded(): Promise<Me | null> {
        if (this.meState() !== undefined)
            return this.me();
        try {
            const me = await firstValueFrom(this.http.get<Me>('/api/v1/auth/me'));
            this.meState.set(me);
            return me;
        }
        catch {
            this.meState.set(null);
            return null;
        }
    }
    async login(username: string, password: string): Promise<Me> {
        const me = await firstValueFrom(this.http.post<Me>('/api/v1/auth/login', { username, password }));
        this.meState.set(me);
        return me;
    }
    async logout(): Promise<void> {
        try {
            await firstValueFrom(this.http.post<void>('/api/v1/auth/logout', {}));
        }
        finally {
            this.meState.set(null);
        }
    }
    sessionExpired(): void {
        this.meState.set(null);
    }
}
