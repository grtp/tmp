// core/user-settings.service.ts — ユーザー個人の設定を1か所で持つ。
// ヘッダー(シェル)と個人設定ダイアログが同じ signal を見るため,変更した
// 瞬間にヘッダーへ反映される。
import { Injectable, computed, inject, signal } from '@angular/core';

import { MeApi } from './api/me-api';
import { UserSettings } from './models';

const DEFAULTS: UserSettings = { headerClockSeconds: false };

@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  private api = inject(MeApi);

  private readonly state = signal<UserSettings>(DEFAULTS);

  readonly settings = computed(() => this.state());
  readonly headerClockSeconds = computed(() => this.state().headerClockSeconds);

  /** シェル起動時に一度読む。失敗しても既定値のまま画面は出す。 */
  async load(): Promise<void> {
    try {
      this.state.set(await this.api.getMySettings());
    } catch {
      // 個人設定が取れなくてもアプリは使えるべきなので既定値で続行する
    }
  }

  /** ログアウト時などに初期化する(次のユーザーへ持ち越さない)。 */
  reset(): void {
    this.state.set(DEFAULTS);
  }

  async setHeaderClockSeconds(on: boolean): Promise<void> {
    // 応答を待たずに反映して操作感を保つ(失敗時は元へ戻す)。
    const before = this.state();
    this.state.set({ ...before, headerClockSeconds: on });
    try {
      this.state.set(await this.api.updateMySettings({ headerClockSeconds: on }));
    } catch (err) {
      this.state.set(before);
      throw err;
    }
  }
}
