// core/auth/auth.service.ts — ログイン状態の管理。
// 認証の決定はバックエンド(Redis セッション + httpOnly cookie)が行い，
// ここは状態を映すだけ。権限も /auth/me が返す actions をそのまま持つ。
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthLevel, Me } from '../models';

const LEVEL_RANK: Record<AuthLevel, number> = { user: 1, maintainer: 2, admin: 3 };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  /** undefined = 未確認(初回ロード前), null = 未ログイン */
  private meState = signal<Me | null | undefined>(undefined);
  readonly me = computed(() => this.meState() ?? null);
  readonly actions = computed(() => this.me()?.actions ?? []);

  /** 指定機能の権限レベル(無ければ null)。 */
  level(code: string): AuthLevel | null {
    return this.actions().find((a) => a.code === code)?.authLevel ?? null;
  }

  /** 指定機能に min 以上の権限を持つか。 */
  allows(code: string, min: AuthLevel): boolean {
    const l = this.level(code);
    return l !== null && LEVEL_RANK[l] >= LEVEL_RANK[min];
  }

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

  /** interceptor が 401 を検知したときに呼ぶ(セッション失効)。 */
  sessionExpired(): void {
    this.meState.set(null);
  }
}
