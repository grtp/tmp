import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { User } from '../models';

// AuthService owns the "who am I" state as a signal. The session token lives in
// an httpOnly cookie (invisible to JS), so the only thing the SPA tracks is the
// resolved user profile.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  private readonly _user = signal<User | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  async login(username: string, password: string): Promise<void> {
    const user = await firstValueFrom(
      this.http.post<User>('/api/auth/login', { username, password }),
    );
    this._user.set(user);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this._user.set(null);
  }

  // Called once on app start to restore the session from the cookie.
  async restore(): Promise<boolean> {
    try {
      const user = await firstValueFrom(this.http.get<User>('/api/auth/me'));
      this._user.set(user);
      return true;
    } catch {
      this._user.set(null);
      return false;
    }
  }
}
