// features/settings — 設定>ユーザー権限(/settings/users)。
// ユーザー × 機能の権限マトリクス(列は機能一覧から作る)。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  SettingsAction,
  SettingsPage,
  SettingsTab,
  SettingsUser,
  UserLevelChange,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { fnLabel } from '../../core/fn-label';
import {
  Action,
  AuthAssignment,
  AuthLevel,
  UserWithAuth,
} from '../../core/models';
import { formatJst } from '../../core/time';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-users-container',
  imports: [SettingsPage],
  templateUrl: './settings-users-container.html',
  styleUrl: './settings-section.css',
})
export class SettingsUsersContainer {
  private admin = inject(AdminApi);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で機能名の翻訳を再評価する(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly visibleTabs = signal<SettingsTab[]>(['users']);
  protected readonly tab = signal<SettingsTab>('users');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly users = signal<UserWithAuth[]>([]);
  private readonly actions = signal<Action[]>([]);

  /** マトリクスの列見出し(機能名は言語切替に追従)。 */
  protected readonly settingsActions = computed<SettingsAction[]>(() => {
    void this.lang();
    return this.actions().map((a) => ({
      ...a,
      name: fnLabel(this.transloco, a.code, a.name),
    }));
  });

  protected readonly settingsUsers = computed<SettingsUser[]>(() =>
    this.users().map((u) => {
      const levels: Record<number, string> = {};
      for (const a of u.auth) levels[a.actionId] = a.authLevel;
      return {
        objectGuid: u.objectGuid,
        username: u.username,
        displayName: u.displayName,
        lastLoginAt: u.lastLoginAt
          ? formatJst(u.lastLoginAt).slice(0, 16)
          : undefined,
        levels,
      };
    }),
  );

  constructor() {
    void this.reload();
  }

  /**
   * silent=true は保存後の再取得用: ローディング表示に切り替えず,
   * 表示中のテーブルを保ったままデータだけ差し替える(全体が
   * 「読み込み中」に置き換わって一瞬ちらつくのを防ぐ)。
   */
  private async reload(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const [users, actions] = await Promise.all([
        this.admin.listUsers(),
        this.admin.listActions(),
      ]);
      this.users.set(users);
      this.actions.set(actions);
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loadFailed'),
      );
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  protected onUserLevelChanged(e: UserLevelChange): void {
    const u = this.users().find((x) => x.objectGuid === e.objectGuid);
    if (!u) return;
    // 現在の付与状態に差分を適用して全置換する(PUT のセマンティクス)。
    const assignments: AuthAssignment[] = u.auth
      .filter((a) => a.actionId !== e.actionId)
      .map((a) => ({ actionId: a.actionId, authLevel: a.authLevel }));
    if (e.level !== '') {
      assignments.push({
        actionId: e.actionId,
        authLevel: e.level as AuthLevel,
      });
    }
    void (async () => {
      this.saving.set(true);
      this.errorMessage.set(null);
      try {
        await this.admin.setUserAuth(e.objectGuid, assignments);
        await this.reload(true);
      } catch (err) {
        this.errorMessage.set(
          apiErrorText(this.transloco, err, 'errors.updateFailed'),
        );
      } finally {
        this.saving.set(false);
      }
    })();
  }
}
