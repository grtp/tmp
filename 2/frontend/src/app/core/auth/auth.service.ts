// core/auth/auth.service.ts — ログイン状態の管理。
// 認証の決定はバックエンド(cookieセッション)が行い、ここは状態を映すだけ。
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Me } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  /** undefined = 未確認(初回ロード前), null = 未ログイン */
  private meState = signal<Me | null | undefined>(undefined);
  readonly me = computed(() => this.meState() ?? null);
  readonly role = computed(() => this.me()?.role ?? null);
  readonly canWrite = computed(() => {
    const r = this.role();
    return r === 'admin' || r === 'maintainer';
  });

  /** cookie が生きているかをサーバーに確認する。ガードと起動時に呼ぶ。 */
  async ensureLoaded(): Promise<Me | null> {
    if (this.meState() !== undefined) return this.me();
    try {
      const me = await firstValueFrom(this.http.get<Me>('/api/v1/auth/me'));
      this.meState.set(me);
      return me;
    } catch {
      this.meState.set(null);
      return null;
    }
  }

  async login(username: string, password: string): Promise<Me> {
    const me = await firstValueFrom(
      this.http.post<Me>('/api/v1/auth/login', { username, password }),
    );
    this.meState.set(me);
    return me;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/v1/auth/logout', {}));
    } finally {
      this.meState.set(null);
    }
  }
}
