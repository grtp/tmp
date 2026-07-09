// features/settings — 設定セクション画面(admin)。
// ルート /settings/:section で表示する:
//   table-maint : 接続情報管理 + テーブル管理 のタブ
//   dashboard   : 機能カード(組込の表示編集 + リンクの追加/編集/削除)
//   users       : ユーザー権限マトリクス
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CandidatePreview,
  CandidateTable,
  ConfirmDialog,
  ConnectionDialog,
  ConnectionDraft,
  ConnectionSubmit,
  DialogConnection,
  ManagedTableDialog,
  ManagedTableRegistration,
  PageHeader,
  SettingsAction,
  SettingsConnection,
  SettingsManagedTable,
  SettingsPage,
  SettingsTab,
  SettingsUser,
  UserLevelChange,
} from '@table-maint/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import {
  Action,
  AuthAssignment,
  AuthLevel,
  Connection,
  ManagedTable,
  UserWithAuth,
} from '../../core/models';

/** ルートの :section -> 表示タブの対応。 */
const SECTIONS: Record<string, { tabs: SettingsTab[]; titleKey: string }> = {
  'table-maint': { tabs: ['connections', 'tables'], titleKey: 'pages.settingsTableMaint' },
  dashboard: { tabs: ['actions'], titleKey: 'pages.settingsDashboard' },
  users: { tabs: ['users'], titleKey: 'pages.settingsUsers' },
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-container',
  imports: [SettingsPage, ManagedTableDialog, ConnectionDialog, ConfirmDialog, PageHeader, TranslocoPipe],
  template: `
    <tm-page-header
      [pageTitle]="pageTitleKey() | transloco"
      [userName]="userName()"
      (backClicked)="router.navigate(['/settings'])"
      (logoutClicked)="logout()"
    />

    @if (errorMessage(); as msg) {
      <p class="error">{{ msg }}</p>
    }

    <tm-settings-page
      [activeTab]="tab()"
      [visibleTabs]="visibleTabs()"
      [managedTables]="settingsTables()"
      [connections]="settingsConnections()"
      [testResults]="testResults()"
      [users]="settingsUsers()"
      [actions]="settingsActions()"
      [loading]="loading()"
      (tabChanged)="tab.set($event)"
      (registerClicked)="openRegister()"
      (tableToggled)="onTableToggled($event)"
      (tableDeleteClicked)="askTableDelete($event)"
      (connectionAddClicked)="openConnectionCreate()"
      (connectionEditClicked)="openConnectionEdit($event)"
      (connectionToggled)="onConnectionToggled($event)"
      (connectionDeleteClicked)="askConnectionDelete($event)"
      (connectionTestClicked)="onConnectionTest($event)"
      (userLevelChanged)="onUserLevelChanged($event)"
      (actionToggled)="onActionToggled($event)"
      (actionDeleteClicked)="askActionDelete($event)"
    />

    <tm-managed-table-dialog
      [open]="registerOpen()"
      [connections]="dialogConnections()"
      [candidates]="candidates()"
      [preview]="preview()"
      [loading]="candidatesLoading()"
      [saving]="saving()"
      [errorMessage]="registerError()"
      (connectionChanged)="onRegisterConnChanged($event)"
      (candidateSelected)="onCandidateSelected($event)"
      (confirmed)="onRegisterConfirmed($event)"
      (cancelled)="registerOpen.set(false)"
    />

    <tm-connection-dialog
      [open]="connDialogOpen()"
      [mode]="connDialogMode()"
      [value]="connDraft()"
      [saving]="saving()"
      [testing]="connTesting()"
      [errorMessage]="connDialogError()"
      [testResult]="connDialogTestResult()"
      (saved)="onConnectionSaved($event)"
      (testClicked)="onConnectionParamTest($event)"
      (cancelled)="connDialogOpen.set(false)"
    />

    <tm-confirm-dialog
      [open]="confirmOpen()"
      [title]="confirmTitle()"
      [message]="confirmMessage()"
      [danger]="true"
      [busy]="saving()"
      (confirmed)="onConfirmed()"
      (cancelled)="confirmOpen.set(false)"
    />
  `,
  styles: `
    .error {
      margin: 12px 16px 0;
      padding: 8px 10px;
      background: var(--tm-danger-bg);
      color: var(--tm-danger);
      border-radius: var(--tm-radius);
      font-size: 12px;
    }
  `,
})
export class SettingsContainer {
  protected readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private admin = inject(AdminApi);
  private tablesApi = inject(TablesApi);
  private transloco = inject(TranslocoService);

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  private readonly section =
    SECTIONS[this.route.snapshot.paramMap.get('section') ?? ''] ?? SECTIONS['table-maint'];

  protected readonly visibleTabs = signal<SettingsTab[]>(this.section.tabs);
  protected readonly pageTitleKey = signal(this.section.titleKey);
  protected readonly tab = signal<SettingsTab>(this.section.tabs[0]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly tables = signal<ManagedTable[]>([]);
  private readonly connections = signal<Connection[]>([]);
  private readonly users = signal<UserWithAuth[]>([]);
  private readonly actions = signal<Action[]>([]);
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
      enabled: c.enabled,
    })),
  );

  protected readonly dialogConnections = computed<DialogConnection[]>(() =>
    this.connections()
      .filter((c) => c.enabled)
      .map((c) => ({ id: c.id, name: c.name })),
  );

  protected readonly settingsActions = computed<SettingsAction[]>(() => this.actions());

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

  // ------------------------------------------------ テーブル登録ダイアログ
  protected readonly registerOpen = signal(false);
  protected readonly candidates = signal<CandidateTable[]>([]);
  protected readonly preview = signal<CandidatePreview | null>(null);
  protected readonly candidatesLoading = signal(false);
  protected readonly registerError = signal<string | null>(null);
  /** 登録ダイアログで選択中の接続(null = 既定DB)。 */
  private registerConnId: number | null = null;

  // ---------------------------------------------------- 接続ダイアログ
  protected readonly connDialogOpen = signal(false);
  protected readonly connDialogMode = signal<'create' | 'edit'>('create');
  protected readonly connDraft = signal<ConnectionDraft | null>(null);
  protected readonly connDialogError = signal<string | null>(null);
  protected readonly connDialogTestResult = signal<string | null>(null);
  protected readonly connTesting = signal(false);
  private editingConnId: number | null = null;

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
      const [tables, connections, users, actions] = await Promise.all([
        this.tablesApi.listTables(true),
        this.admin.listConnections(),
        this.admin.listUsers(),
        this.admin.listActions(),
      ]);
      this.tables.set(tables);
      this.connections.set(connections);
      this.users.set(users);
      this.actions.set(actions);
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
    this.registerOpen.set(true);
    this.registerError.set(null);
    this.preview.set(null);
    this.registerConnId = null;
    await this.loadCandidates(null);
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
      await this.admin.createManagedTable(e);
      this.registerOpen.set(false);
      await this.reload();
    } catch (err) {
      this.registerError.set(apiErrorText(this.transloco, err, 'errors.registerFailed'));
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

  // ------------------------------------------------------------- confirm

  protected async onConfirmed(): Promise<void> {
    const f = this.confirmAction;
    if (!f) return;
    await this.run(f, 'errors.deleteFailed');
    this.confirmOpen.set(false);
    this.confirmAction = null;
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
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
