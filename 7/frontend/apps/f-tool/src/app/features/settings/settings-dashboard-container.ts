// features/settings — 設定>ダッシュボード(/settings/dashboard)。
// 機能カード(組込機能の表示編集)と配布テンプレートの CRUD。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  ConfirmDialog,
  EditorAction,
  EditorItem,
  EditorTable,
  SettingsAction,
  SettingsDashTemplate,
  SettingsPage,
  SettingsTab,
  TemplateDraft,
  TemplateEditorDialog,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { DashApi } from '../../core/api/dash-api';
import { TablesApi } from '../../core/api/tables-api';
import { fnLabel } from '../../core/fn-label';
import {
  Action,
  DashTemplate,
  DashTemplateItem,
  DashTemplateItemInput,
  ManagedTable,
} from '../../core/models';

/** テンプレートのカードにできない機能(サイドバー専用)。 */
const SIDEBAR_ONLY = new Set(['settings', 'history']);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-dashboard-container',
  imports: [SettingsPage, TemplateEditorDialog, ConfirmDialog],
  templateUrl: './settings-dashboard-container.html',
  styleUrl: './settings-section.css',
})
export class SettingsDashboardContainer {
  private admin = inject(AdminApi);
  private tablesApi = inject(TablesApi);
  private dashApi = inject(DashApi);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で機能名の翻訳を再評価する(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly visibleTabs = signal<SettingsTab[]>(['actions', 'templates']);
  protected readonly tab = signal<SettingsTab>('actions');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly actions = signal<Action[]>([]);
  private readonly templates = signal<DashTemplate[]>([]);
  /** テンプレートのテーブル項目の選択肢(enabled のみ表示に使う)。 */
  private readonly tables = signal<ManagedTable[]>([]);

  protected readonly settingsActions = computed<SettingsAction[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    return this.actions().map((a) => ({ ...a, name: fnLabel(this.transloco, a.code, a.name) }));
  });

  protected readonly settingsTemplates = computed<SettingsDashTemplate[]>(() =>
    this.templates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      enabled: t.enabled,
    })),
  );

  /** テンプレートに追加できる機能(サイドバー専用と無効を除く)。 */
  protected readonly editorActions = computed<EditorAction[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    return this.actions()
      .filter((a) => a.enabled && !SIDEBAR_ONLY.has(a.code))
      .map((a) => ({ id: a.id, code: a.code, name: fnLabel(this.transloco, a.code, a.name), icon: a.icon }));
  });

  /** テンプレートに追加できる管理対象テーブル(enabled のみ)。 */
  protected readonly editorTables = computed<EditorTable[]>(() =>
    this.tables()
      .filter((t) => t.enabled)
      .map((t) => ({ id: t.id, displayName: t.displayName })),
  );

  protected readonly templateEditorOpen = signal(false);
  protected readonly templateEditorMode = signal<'create' | 'edit'>('create');
  protected readonly templateDraft = signal<TemplateDraft | null>(null);
  protected readonly templateEditorError = signal<string | null>(null);
  private editingTemplateId: number | null = null;

  protected readonly confirmOpen = signal(false);
  protected readonly confirmTitle = signal('');
  protected readonly confirmMessage = signal('');
  private confirmAction: (() => Promise<void>) | null = null;

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [actions, templates, tables] = await Promise.all([
        this.admin.listActions(),
        this.dashApi.listTemplates(true),
        this.tablesApi.listTables(true),
      ]);
      this.actions.set(actions);
      this.templates.set(templates);
      this.tables.set(tables);
    } catch (err) {
      this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(f: () => Promise<void>, fallbackKey: string): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      await f();
      await this.reload();
    } catch (err) {
      this.errorMessage.set(apiErrorText(this.transloco, err, fallbackKey));
    } finally {
      this.saving.set(false);
    }
  }

  protected onActionToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.admin.updateAction(e.id, { enabled: e.enabled });
    }, 'errors.updateFailed');
  }

  protected askActionDelete(id: number): void {
    const a = this.actions().find((x) => x.id === id);
    this.confirmTitle.set(this.transloco.translate('confirms.deleteActionTitle'));
    this.confirmMessage.set(
      this.transloco.translate('confirms.deleteActionMessage', { name: a?.name ?? id }),
    );
    this.confirmAction = async () => {
      await this.admin.deleteAction(id);
    };
    this.confirmOpen.set(true);
  }

  protected openTemplateCreate(): void {
    this.templateEditorMode.set('create');
    this.editingTemplateId = null;
    this.templateDraft.set(null);
    this.templateEditorError.set(null);
    this.templateEditorOpen.set(true);
  }

  protected async openTemplateEdit(id: number): Promise<void> {
    this.errorMessage.set(null);
    try {
      const t = await this.dashApi.getTemplate(id);
      this.templateEditorMode.set('edit');
      this.editingTemplateId = id;
      this.templateDraft.set({
        name: t.name,
        description: t.description ?? '',
        enabled: t.enabled,
        items: (t.items ?? []).map((it) => this.toEditorItem(it)),
      });
      this.templateEditorError.set(null);
      this.templateEditorOpen.set(true);
    } catch (err) {
      this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
    }
  }

  /** API の item -> エディタ表示用(機能名/アイコンは actions から解決)。 */
  private toEditorItem(it: DashTemplateItem): EditorItem {
    if (it.kind === 'action') {
      const a = this.actions().find((x) => x.id === it.actionId);
      return {
        kind: 'action',
        actionId: it.actionId,
        label: a?.name ?? it.actionCode ?? String(it.actionId ?? ''),
        icon: a?.icon ?? 'apps',
      };
    }
    if (it.kind === 'table') {
      return {
        kind: 'table',
        managedTableId: it.managedTableId,
        label: it.managedTableName ?? String(it.managedTableId ?? ''),
        icon: 'table',
      };
    }
    return {
      kind: 'link',
      label: it.name ?? '',
      url: it.url ?? '',
      icon: it.icon ?? 'external-link',
    };
  }

  protected async onTemplateSaved(draft: TemplateDraft): Promise<void> {
    this.saving.set(true);
    this.templateEditorError.set(null);
    try {
      // description は空欄 = クリアとして常に送る(PATCH 省略 = 変更なしのため)。
      const body = { name: draft.name, description: draft.description, enabled: draft.enabled };
      const id =
        this.editingTemplateId !== null
          ? (await this.dashApi.updateTemplate(this.editingTemplateId, body)).id
          : (await this.dashApi.createTemplate(body)).id;
      const items: DashTemplateItemInput[] = draft.items.map((it) => {
        if (it.kind === 'action') return { kind: 'action' as const, actionId: it.actionId };
        if (it.kind === 'table') {
          return { kind: 'table' as const, managedTableId: it.managedTableId };
        }
        return { kind: 'link' as const, name: it.label, url: it.url, icon: it.icon };
      });
      await this.dashApi.setTemplateItems(id, items);
      this.templateEditorOpen.set(false);
      await this.reload();
    } catch (err) {
      this.templateEditorError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected onTemplateToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.dashApi.updateTemplate(e.id, { enabled: e.enabled });
    }, 'errors.updateFailed');
  }

  protected askTemplateDelete(id: number): void {
    const t = this.templates().find((x) => x.id === id);
    this.confirmTitle.set(this.transloco.translate('confirms.deleteTemplateTitle'));
    this.confirmMessage.set(
      this.transloco.translate('confirms.deleteTemplateMessage', { name: t?.name ?? id }),
    );
    this.confirmAction = async () => {
      await this.dashApi.deleteTemplate(id);
    };
    this.confirmOpen.set(true);
  }

  protected async onConfirmed(): Promise<void> {
    const f = this.confirmAction;
    if (!f) return;
    await this.run(f, 'errors.deleteFailed');
    this.confirmOpen.set(false);
    this.confirmAction = null;
  }
}
