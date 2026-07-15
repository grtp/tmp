// features/settings — 設定セクション画面(admin)。
// ルート /settings/:section で表示する:
//   table-maint : 接続情報管理 + テーブル管理 のタブ
//   dashboard   : 機能カード(組込の表示編集 + リンクの追加/編集/削除)
//   users       : ユーザー権限マトリクス
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  CandidatePreview,
  CandidateTable,
  ConfirmDialog,
  ConnectionDialog,
  ConnectionDraft,
  ConnectionSubmit,
  DialogConnection,
  EditorAction,
  EditorItem,
  EditorTable,
  ManagedTableEditValue,
  ManagedTableDialog,
  ManagedTableRegistration,
  SettingsAction,
  SettingsConnection,
  SettingsDashTemplate,
  SettingsManagedTable,
  SettingsPage,
  SettingsTab,
  SettingsUser,
  TemplateDraft,
  TemplateEditorDialog,
  UserLevelChange,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { DashApi } from '../../core/api/dash-api';
import { TablesApi } from '../../core/api/tables-api';
import { fnLabel } from '../../core/fn-label';
import {
  Action,
  AuthAssignment,
  AuthLevel,
  Connection,
  DashTemplate,
  DashTemplateItem,
  DashTemplateItemInput,
  ManagedTable,
  UserWithAuth,
} from '../../core/models';

/** ルートの :section -> 表示タブの対応。 */
const SECTIONS: Record<string, { tabs: SettingsTab[] }> = {
  'table-maint': { tabs: ['connections', 'tables'] },
  dashboard: { tabs: ['actions', 'templates'] },
  users: { tabs: ['users'] },
};

/** テンプレートのカードにできない機能(サイドバー専用)。 */
const SIDEBAR_ONLY = new Set(['settings', 'history']);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-container',
  imports: [SettingsPage, ManagedTableDialog, ConnectionDialog, TemplateEditorDialog, ConfirmDialog],
  templateUrl: './settings-container.html',
  styleUrl: './settings-container.css',
})
export class SettingsContainer {
  private route = inject(ActivatedRoute);
  private admin = inject(AdminApi);
  private tablesApi = inject(TablesApi);
  private dashApi = inject(DashApi);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で機能名の翻訳を再評価する(直リロード時の生キー表示対策)。
  private readonly lang = toSignal(this.transloco.selectTranslation());

  private readonly section =
    SECTIONS[this.route.snapshot.paramMap.get('section') ?? ''] ?? SECTIONS['table-maint'];

  protected readonly visibleTabs = signal<SettingsTab[]>(this.section.tabs);
  protected readonly tab = signal<SettingsTab>(this.section.tabs[0]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly tables = signal<ManagedTable[]>([]);
  private readonly connections = signal<Connection[]>([]);
  private readonly users = signal<UserWithAuth[]>([]);
  private readonly actions = signal<Action[]>([]);
  private readonly templates = signal<DashTemplate[]>([]);
  protected readonly testResults = signal<Record<number, string>>({});

  // 表示用への写像(libs/ui はアプリの model を知らない)
  protected readonly settingsTables = computed<SettingsManagedTable[]>(() =>
    this.tables().map((t) => ({
      id: t.id,
      schemaName: t.schemaName,
      tableName: t.tableName,
      displayName: t.displayName,
      description: t.description,
      connectionName: t.connectionName ?? undefined,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
  );

  protected readonly settingsConnections = computed<SettingsConnection[]>(() =>
    this.connections().map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      databaseName: c.databaseName,
      username: c.username,
      schemaName: c.schemaName,
      enabled: c.enabled,
    })),
  );

  protected readonly dialogConnections = computed<DialogConnection[]>(() =>
    this.connections()
      .filter((c) => c.enabled)
      .map((c) => ({ id: c.id, name: c.name, schemaName: c.schemaName })),
  );

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

  protected readonly settingsUsers = computed<SettingsUser[]>(() =>
    this.users().map((u) => {
      const levels: Record<number, string> = {};
      for (const a of u.auth) levels[a.actionId] = a.authLevel;
      return {
        objectGuid: u.objectGuid,
        username: u.username,
        displayName: u.displayName,
        lastLoginAt: u.lastLoginAt?.slice(0, 16).replace('T', ' '),
        levels,
      };
    }),
  );

  // ------------------------------------------------ テーブル登録/編集ダイアログ
  protected readonly registerOpen = signal(false);
  protected readonly registerMode = signal<'create' | 'edit'>('create');
  protected readonly tableEditValue = signal<ManagedTableEditValue | null>(null);
  protected readonly candidates = signal<CandidateTable[]>([]);
  protected readonly preview = signal<CandidatePreview | null>(null);
  protected readonly candidatesLoading = signal(false);
  protected readonly registerError = signal<string | null>(null);
  /** 登録ダイアログで選択中の接続(null = 既定DB)。 */
  private registerConnId: number | null = null;
  /** 編集中の管理テーブル id(null = 新規登録)。 */
  private editingTableId: number | null = null;

  // ---------------------------------------------------- 接続ダイアログ
  protected readonly connDialogOpen = signal(false);
  protected readonly connDialogMode = signal<'create' | 'edit'>('create');
  protected readonly connDraft = signal<ConnectionDraft | null>(null);
  protected readonly connDialogError = signal<string | null>(null);
  protected readonly connDialogTestResult = signal<string | null>(null);
  protected readonly connTesting = signal(false);
  private editingConnId: number | null = null;

  // -------------------------------------------- テンプレートエディタ
  protected readonly templateEditorOpen = signal(false);
  protected readonly templateEditorMode = signal<'create' | 'edit'>('create');
  protected readonly templateDraft = signal<TemplateDraft | null>(null);
  protected readonly templateEditorError = signal<string | null>(null);
  private editingTemplateId: number | null = null;

  // ------------------------------------------------------ 確認ダイアログ
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
      const [tables, connections, users, actions, templates] = await Promise.all([
        this.tablesApi.listTables(true),
        this.admin.listConnections(),
        this.admin.listUsers(),
        this.admin.listActions(),
        this.dashApi.listTemplates(true),
      ]);
      this.tables.set(tables);
      this.connections.set(connections);
      this.users.set(users);
      this.actions.set(actions);
      this.templates.set(templates);
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

  // -------------------------------------------------------------- tables

  protected async openRegister(): Promise<void> {
    this.registerMode.set('create');
    this.editingTableId = null;
    this.tableEditValue.set(null);
    this.registerOpen.set(true);
    this.registerError.set(null);
    this.preview.set(null);
    this.registerConnId = null;
    await this.loadCandidates(null);
  }

  /**
   * 管理テーブル行クリック → 編集ダイアログ。
   * 接続・実テーブルは固定で、表示名/説明/列モードだけ変更できる。
   */
  protected async openTableEdit(id: number): Promise<void> {
    const t = this.tables().find((x) => x.id === id);
    if (!t) return;
    this.registerMode.set('edit');
    this.editingTableId = id;
    this.tableEditValue.set({
      schemaName: t.schemaName,
      tableName: t.tableName,
      connectionName: t.connectionName ?? undefined,
      displayName: t.displayName,
      description: t.description ?? '',
      readonlyColumns: t.readonlyColumns ?? [],
      hiddenColumns: t.hiddenColumns ?? [],
    });
    this.registerError.set(null);
    this.preview.set(null);
    this.registerOpen.set(true);
    // 列モードの選択肢は実カタログの現在の列で出す(登録時と同じプレビュー)。
    this.registerConnId = t.connectionId ?? null;
    await this.onCandidateSelected({ schemaName: t.schemaName, tableName: t.tableName });
  }

  private async loadCandidates(connId: number | null): Promise<void> {
    this.candidatesLoading.set(true);
    this.candidates.set([]);
    try {
      const list = await this.admin.listSchemaTables(connId);
      this.candidates.set(
        list.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
          hasPrimaryKey: t.hasPrimaryKey,
        })),
      );
    } catch (err) {
      this.registerError.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
    } finally {
      this.candidatesLoading.set(false);
    }
  }

  protected async onRegisterConnChanged(connId: number | null): Promise<void> {
    this.registerConnId = connId;
    this.registerError.set(null);
    this.preview.set(null);
    await this.loadCandidates(connId);
  }

  protected async onCandidateSelected(e: { schemaName: string; tableName: string }): Promise<void> {
    this.preview.set(null);
    try {
      const p = await this.admin.previewSchemaTable(e.schemaName, e.tableName, this.registerConnId);
      this.preview.set({
        primaryKey: p.primaryKey,
        hasRowVersion: p.hasRowVersion,
        columns: p.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          readonly: c.readonly,
          required: c.required,
        })),
      });
    } catch (err) {
      this.registerError.set(apiErrorText(this.transloco, err, 'errors.loadFailed'));
    }
  }

  protected async onRegisterConfirmed(e: ManagedTableRegistration): Promise<void> {
    this.saving.set(true);
    this.registerError.set(null);
    try {
      if (this.editingTableId !== null) {
        // 編集: 表示名/説明/列モードのみ更新(接続・実テーブルは変更不可)。
        await this.admin.updateManagedTable(this.editingTableId, {
          displayName: e.displayName,
          description: e.description ?? '',
          readonlyColumns: e.readonlyColumns,
          hiddenColumns: e.hiddenColumns,
        });
      } else {
        await this.admin.createManagedTable(e);
      }
      this.registerOpen.set(false);
      await this.reload();
    } catch (err) {
      this.registerError.set(
        apiErrorText(
          this.transloco,
          err,
          this.editingTableId !== null ? 'errors.saveFailed' : 'errors.registerFailed',
        ),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected onTableToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.admin.updateManagedTable(e.id, { enabled: e.enabled });
    }, 'errors.updateFailed');
  }

  protected askTableDelete(id: number): void {
    const t = this.tables().find((x) => x.id === id);
    this.confirmTitle.set(this.transloco.translate('confirms.unregisterTitle'));
    this.confirmMessage.set(
      this.transloco.translate('confirms.unregisterMessage', { name: t?.displayName ?? id }),
    );
    this.confirmAction = async () => {
      await this.admin.deleteManagedTable(id);
    };
    this.confirmOpen.set(true);
  }

  // --------------------------------------------------------- connections

  protected openConnectionCreate(): void {
    this.connDialogMode.set('create');
    this.editingConnId = null;
    this.connDraft.set(null);
    this.connDialogError.set(null);
    this.connDialogTestResult.set(null);
    this.connDialogOpen.set(true);
  }

  protected openConnectionEdit(id: number): void {
    const c = this.connections().find((x) => x.id === id);
    if (!c) return;
    this.connDialogMode.set('edit');
    this.editingConnId = id;
    this.connDraft.set({
      name: c.name,
      host: c.host,
      port: c.port,
      databaseName: c.databaseName,
      username: c.username,
      options: c.options,
      schemaName: c.schemaName,
      enabled: c.enabled,
    });
    this.connDialogError.set(null);
    this.connDialogTestResult.set(null);
    this.connDialogOpen.set(true);
  }

  protected async onConnectionSaved(e: ConnectionSubmit): Promise<void> {
    this.saving.set(true);
    this.connDialogError.set(null);
    try {
      if (this.connDialogMode() === 'create') {
        await this.admin.createConnection({
          name: e.name,
          host: e.host,
          port: e.port,
          databaseName: e.databaseName,
          username: e.username,
          password: e.password,
          options: e.options,
          schemaName: e.schemaName,
        });
      } else {
        await this.admin.updateConnection(this.editingConnId!, {
          name: e.name,
          host: e.host,
          port: e.port,
          databaseName: e.databaseName,
          username: e.username,
          // 空欄 = 変更なし(送らない)
          ...(e.password !== '' ? { password: e.password } : {}),
          options: e.options,
          schemaName: e.schemaName,
        });
      }
      this.connDialogOpen.set(false);
      await this.reload();
    } catch (err) {
      this.connDialogError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /** 保存前の疎通テスト(ダイアログ内)。 */
  protected async onConnectionParamTest(e: ConnectionSubmit): Promise<void> {
    this.connTesting.set(true);
    this.connDialogTestResult.set(null);
    try {
      // 編集時にパスワード空欄なら保存済み資格情報でテストする。
      const result =
        e.password === '' && this.editingConnId !== null
          ? await this.admin.testConnection(this.editingConnId)
          : await this.admin.testConnectionParams({
              name: e.name || 'test',
              host: e.host,
              port: e.port,
              databaseName: e.databaseName,
              username: e.username,
              password: e.password,
              options: e.options,
            });
      this.connDialogTestResult.set(formatTestResult(this.transloco, result));
    } catch (err) {
      this.connDialogTestResult.set(apiErrorText(this.transloco, err, 'errors.testFailed'));
    } finally {
      this.connTesting.set(false);
    }
  }

  /** 一覧の[接続テスト](保存済み接続)。 */
  protected async onConnectionTest(id: number): Promise<void> {
    this.testResults.update((m) => ({ ...m, [id]: '…' }));
    try {
      const result = await this.admin.testConnection(id);
      this.testResults.update((m) => ({ ...m, [id]: formatTestResult(this.transloco, result) }));
    } catch (err) {
      this.testResults.update((m) => ({
        ...m,
        [id]: apiErrorText(this.transloco, err, 'errors.testFailed'),
      }));
    }
  }

  protected onConnectionToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.admin.updateConnection(e.id, { enabled: e.enabled });
    }, 'errors.updateFailed');
  }

  protected askConnectionDelete(id: number): void {
    const c = this.connections().find((x) => x.id === id);
    this.confirmTitle.set(this.transloco.translate('confirms.deleteConnectionTitle'));
    this.confirmMessage.set(
      this.transloco.translate('confirms.deleteConnectionMessage', { name: c?.name ?? id }),
    );
    this.confirmAction = async () => {
      await this.admin.deleteConnection(id);
    };
    this.confirmOpen.set(true);
  }

  // --------------------------------------------------------------- users

  protected onUserLevelChanged(e: UserLevelChange): void {
    const u = this.users().find((x) => x.objectGuid === e.objectGuid);
    if (!u) return;
    // 現在の付与状態に差分を適用して全置換する(PUT のセマンティクス)。
    const assignments: AuthAssignment[] = u.auth
      .filter((a) => a.actionId !== e.actionId)
      .map((a) => ({ actionId: a.actionId, authLevel: a.authLevel }));
    if (e.level !== '') {
      assignments.push({ actionId: e.actionId, authLevel: e.level as AuthLevel });
    }
    void this.run(async () => {
      await this.admin.setUserAuth(e.objectGuid, assignments);
    }, 'errors.updateFailed');
  }

  // ------------------------------------------------------------- actions

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

  // ----------------------------------------------------------- templates

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

  // ------------------------------------------------------------- confirm

  protected async onConfirmed(): Promise<void> {
    const f = this.confirmAction;
    if (!f) return;
    await this.run(f, 'errors.deleteFailed');
    this.confirmOpen.set(false);
    this.confirmAction = null;
  }
}

function formatTestResult(
  transloco: TranslocoService,
  r: { ok: boolean; message?: string; latencyMs?: number },
): string {
  if (r.ok) {
    return transloco.translate('settings.testOk', { ms: r.latencyMs ?? 0 });
  }
  return r.message || transloco.translate('errors.testFailed');
}
