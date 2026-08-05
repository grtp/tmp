// features/settings — 設定>ホーム設定(/settings/home)。
// ホーム画面のウィジェット構成をビルダー(tm-home-builder)で編集する。
// 保存 = 即公開(下書きなし)。JSON の直接編集は2環境間の持ち運び用。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { HomeBuilder, HomeWidgetConfig, RequiresOption } from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { HomeApi } from '../../core/api/home-api';
import { AuthService } from '../../core/auth/auth.service';
import { confirmAsync } from '../../core/dialog';
import { fnLabel } from '../../core/fn-label';
import { Action } from '../../core/models';
import { ConfirmsLeave } from '../../core/pending-changes.guard';
import { parseHomeConfig, visibleWidgets } from '../home/home-config';

/** 保存 JSON の正規形(キー順・空白を固定して dirty 比較を安定させる)。 */
function canonical(widgets: HomeWidgetConfig[]): string {
  return JSON.stringify({ version: 1, widgets });
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-home-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [HomeBuilder],
  templateUrl: './settings-home-container.html',
})
export class SettingsHomeContainer implements ConfirmsLeave {
  private homeApi = inject(HomeApi);
  private admin = inject(AdminApi);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で requires 選択肢の機能名を再評価する
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly widgets = signal<HomeWidgetConfig[]>([]);
  /** プレビュー用: 閲覧ページと同じ権限フィルタを通した「実際の表示」。 */
  protected readonly previewWidgets = computed(() =>
    visibleWidgets(this.widgets(), (code) => this.auth.allows(code, 'user')),
  );
  /** 保存済み状態の正規形 JSON(dirty 判定の基準)。 */
  private readonly savedCanonical = signal(canonical([]));
  protected readonly dirty = computed(
    () => canonical(this.widgets()) !== this.savedCanonical(),
  );

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly jsonError = signal<string | null>(null);

  private readonly actions = signal<Action[]>([]);
  protected readonly requiresOptions = computed<RequiresOption[]>(() => {
    void this.lang();
    return this.actions().map((a) => ({
      code: a.code,
      label: fnLabel(this.transloco, a.code, a.name),
    }));
  });

  constructor() {
    void this.load();
  }

  /**
   * 未設定(config null)時にホームが出す組込既定と同じ内容を,編集可能な
   * ウィジェットとして実体化する(空キャンバスではなく「現在の表示」から
   * 編集を始められるように)。項目単位の requires で,閲覧側の
   * 権限フィルタと同じ見え方を保存後も再現できる。
   */
  private defaultWidgets(): HomeWidgetConfig[] {
    return [{
      type: 'cards',
      size: 3,
      items: this.actions()
        .filter((a) => a.enabled)
        .map((a) => ({
          label: fnLabel(this.transloco, a.code, a.name),
          url: '/' + a.code,
          icon: a.icon,
          requires: a.code,
        })),
    }];
  }

  private async load(): Promise<void> {
    try {
      const [cfg, actions] = await Promise.all([
        this.homeApi.getHomeConfig(),
        this.admin.listActions(),
      ]);
      this.actions.set(actions);
      const parsed = cfg.config !== null ? parseHomeConfig(cfg.config) : null;
      const widgets = parsed ?? this.defaultWidgets();
      this.widgets.set(widgets);
      this.savedCanonical.set(canonical(widgets));
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loadFailed'),
      );
    }
  }

  protected onWidgetsChanged(next: HomeWidgetConfig[]): void {
    this.jsonError.set(null);
    this.widgets.set(next);
  }

  /** 保存 = 即公開。全ユーザーに反映されるため確認を挟む。 */
  protected async onSave(): Promise<void> {
    const t = (key: string) => this.transloco.translate(key);
    const ok = await confirmAsync(this.dialog, {
      title: t('homeBuilder.saveTitle'),
      message: t('homeBuilder.saveMessage'),
      confirmLabel: t('homeBuilder.save'),
    });
    if (!ok) return;

    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      const json = canonical(this.widgets());
      await this.homeApi.setHomeConfig(json);
      this.savedCanonical.set(json);
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.updateFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** 既定に戻す = 設定を削除(config null)。ホームは組込の機能カード一覧に戻る。 */
  protected async onReset(): Promise<void> {
    const t = (key: string) => this.transloco.translate(key);
    const ok = await confirmAsync(this.dialog, {
      title: t('homeBuilder.resetTitle'),
      message: t('homeBuilder.resetMessage'),
      confirmLabel: t('homeBuilder.reset'),
      danger: true,
    });
    if (!ok) return;

    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      await this.homeApi.setHomeConfig(null);
      // 未設定に戻した後も「現在の表示」= 組込既定を編集起点として見せる
      const widgets = this.defaultWidgets();
      this.widgets.set(widgets);
      this.savedCanonical.set(canonical(widgets));
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.updateFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** JSON 直接編集の適用。パーサ(ホーム表示と同じ)を通してから反映する。 */
  protected onJsonApplied(text: string): void {
    const parsed = parseHomeConfig(text);
    if (parsed === null) {
      this.jsonError.set(this.transloco.translate('homeBuilder.jsonInvalid'));
      return;
    }
    this.jsonError.set(null);
    this.widgets.set(parsed);
  }

  /** pendingChangesGuard: 未保存の変更があれば離脱確認を挟む。 */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    const t = (key: string) => this.transloco.translate(key);
    return confirmAsync(this.dialog, {
      title: t('homeBuilder.leaveTitle'),
      message: t('homeBuilder.leaveMessage'),
      confirmLabel: t('homeBuilder.leaveConfirm'),
      danger: true,
    });
  }
}
