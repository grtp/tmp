// features/settings — 設定>機能設定(/settings/functions)。
// 機能マスタ(組込機能の有効/無効)の編集。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { SettingsAction, SettingsPage, SettingsTab } from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { fnLabel } from '../../core/fn-label';
import { Action } from '../../core/models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-functions-container',
  imports: [SettingsPage],
  templateUrl: './settings-functions-container.html',
  styleUrl: './settings-section.css',
})
export class SettingsFunctionsContainer {
  private admin = inject(AdminApi);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で機能名の翻訳を再評価する(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly visibleTabs = signal<SettingsTab[]>(['actions']);
  protected readonly tab = signal<SettingsTab>('actions');
  protected readonly loading = signal(false);

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly actions = signal<Action[]>([]);

  protected readonly settingsActions = computed<SettingsAction[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    return this.actions().map((a) => ({
      ...a,
      name: fnLabel(this.transloco, a.code, a.name),
    }));
  });

  constructor() {
    void this.reload();
  }

  /** silent=true は保存後の再取得用(ローディング表示に切り替えない)。 */
  private async reload(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      this.actions.set(await this.admin.listActions());
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loadFailed'),
      );
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  protected onActionToggled(e: { id: number; enabled: boolean }): void {
    void (async () => {
      this.saving.set(true);
      this.errorMessage.set(null);
      try {
        await this.admin.updateAction(e.id, { enabled: e.enabled });
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
