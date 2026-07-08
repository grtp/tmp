// features/settings — 設定画面(admin)。
// 管理テーブルの登録/解除、ユーザー権限マトリクス、機能マスタの編集。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  CandidatePreview,
  CandidateTable,
  ConfirmDialog,
  ManagedTableDialog,
  ManagedTableRegistration,
  PageHeader,
  SettingsAction,
  SettingsManagedTable,
  SettingsPage,
  SettingsTab,
  SettingsUser,
  UserLevelChange,
} from '@table-maint/ui';

import { AdminApi } from '../../core/api/admin-api';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import {
  Action,
  AuthAssignment,
  AuthLevel,
  ManagedTable,
  UserWithAuth,
  apiErrorMessage,
} from '../../core/models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-container',
  imports: [SettingsPage, ManagedTableDialog, ConfirmDialog, PageHeader],
  template: `
    <tm-page-header
      pageTitle="設定"
      [userName]="userName()"
      (backClicked)="router.navigate(['/dashboard'])"
      (logoutClicked)="logout()"
    />

    @if (errorMessage(); as msg) {
      <p class="error">{{ msg }}</p>
    }

    <tm-settings-page
      [activeTab]="tab()"
      [managedTables]="settingsTables()"
      [users]="settingsUsers()"
      [actions]="settingsActions()"
      [loading]="loading()"
      (tabChanged)="tab.set($event)"
      (registerClicked)="openRegister()"
      (tableToggled)="onTableToggled($event)"
      (tableDeleteClicked)="askTableDelete($event)"
      (userLevelChanged)="onUserLevelChanged($event)"
      (actionCreated)="onActionCreated($event)"
      (actionToggled)="onActionToggled($event)"
      (actionDeleteClicked)="askActionDelete($event)"
    />

    <tm-managed-table-dialog
      [open]="registerOpen()"
      [candidates]="candidates()"
      [preview]="preview()"
      [loading]="candidatesLoading()"
      [saving]="saving()"
      [errorMessage]="registerError()"
      (candidateSelected)="onCandidateSelected($event)"
      (confirmed)="onRegisterConfirmed($event)"
      (cancelled)="registerOpen.set(false)"
    />

    <tm-confirm-dialog
      [open]="confirmOpen()"
      [title]="confirmTitle()"
      [message]="confirmMessage()"
      confirmLabel="実行"
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
  private auth = inject(AuthService);
  private admin = inject(AdminApi);
  private tablesApi = inject(TablesApi);

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  protected readonly tab = signal<SettingsTab>('tables');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly tables = signal<ManagedTable[]>([]);
  private readonly users = signal<UserWithAuth[]>([]);
  private readonly actions = signal<Action[]>([]);

  // 表示用への写像(libs/ui はアプリの model を知らない)
  protected readonly settingsTables = computed<SettingsManagedTable[]>(() =>
    this.tables().map((t) => ({
      id: t.id,
      schemaName: t.schemaName,
      tableName: t.tableName,
      displayName: t.displayName,
      description: t.description,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
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

  // ------------------------------------------------------ 登録ダイアログ
  protected readonly registerOpen = signal(false);
  protected readonly candidates = signal<CandidateTable[]>([]);
  protected readonly preview = signal<CandidatePreview | null>(null);
  protected readonly candidatesLoading = signal(false);
  protected readonly registerError = signal<string | null>(null);

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
      const [tables, users, actions] = await Promise.all([
        this.tablesApi.listTables(true),
        this.admin.listUsers(),
        this.admin.listActions(),
      ]);
      this.tables.set(tables);
      this.users.set(users);
      this.actions.set(actions);
    } catch (err) {
      this.errorMessage.set(apiErrorMessage(err, '設定の読み込みに失敗しました'));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(f: () => Promise<void>, fallback: string): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      await f();
      await this.reload();
    } catch (err) {
      this.errorMessage.set(apiErrorMessage(err, fallback));
    } finally {
      this.saving.set(false);
    }
  }

  // -------------------------------------------------------------- tables

  protected async openRegister(): Promise<void> {
    this.registerOpen.set(true);
    this.registerError.set(null);
    this.preview.set(null);
    this.candidatesLoading.set(true);
    try {
      const list = await this.admin.listSchemaTables();
      this.candidates.set(
        list.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
          hasPrimaryKey: t.hasPrimaryKey,
        })),
      );
    } catch (err) {
      this.registerError.set(apiErrorMessage(err, '候補の取得に失敗しました'));
    } finally {
      this.candidatesLoading.set(false);
    }
  }

  protected async onCandidateSelected(e: { schemaName: string; tableName: string }): Promise<void> {
    this.preview.set(null);
    try {
      const p = await this.admin.previewSchemaTable(e.schemaName, e.tableName);
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
      this.registerError.set(apiErrorMessage(err, 'プレビューの取得に失敗しました'));
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
      this.registerError.set(apiErrorMessage(err, '登録に失敗しました'));
    } finally {
      this.saving.set(false);
    }
  }

  protected onTableToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.admin.updateManagedTable(e.id, { enabled: e.enabled });
    }, '更新に失敗しました');
  }

  protected askTableDelete(id: number): void {
    const t = this.tables().find((x) => x.id === id);
    this.confirmTitle.set('登録解除');
    this.confirmMessage.set(
      `「${t?.displayName ?? id}」を管理対象から外します。実テーブルは削除されません。`,
    );
    this.confirmAction = async () => {
      await this.admin.deleteManagedTable(id);
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
    }, '権限の更新に失敗しました');
  }

  // ------------------------------------------------------------- actions

  protected onActionCreated(e: { code: string; name: string; icon: string }): void {
    void this.run(async () => {
      await this.admin.createAction(e);
    }, '機能の追加に失敗しました');
  }

  protected onActionToggled(e: { id: number; enabled: boolean }): void {
    void this.run(async () => {
      await this.admin.updateAction(e.id, { enabled: e.enabled });
    }, '機能の更新に失敗しました');
  }

  protected askActionDelete(id: number): void {
    const a = this.actions().find((x) => x.id === id);
    this.confirmTitle.set('機能の削除');
    this.confirmMessage.set(
      `機能「${a?.name ?? id}」を削除します。付与済みの権限も削除されます。`,
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
    await this.run(f, '操作に失敗しました');
    this.confirmOpen.set(false);
    this.confirmAction = null;
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
