// features/settings — 設定>テーブルメンテナンス(/settings/table-maint)。
// 管理テーブルの登録/編集/解除と，接続情報の CRUD・疎通テスト。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  CandidatePreview,
  CandidateTable,
  ConfirmDialog,
  ConnectionDialog,
  ConnectionDraft,
  ConnectionSubmit,
  DialogConnection,
  ManagedTableEditValue,
  ManagedTableDialog,
  ManagedTableRegistration,
  SettingsConnection,
  SettingsManagedTable,
  SettingsPage,
  SettingsTab,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AdminApi } from '../../core/api/admin-api';
import { TablesApi } from '../../core/api/tables-api';
import { Connection, ManagedTable } from '../../core/models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-table-maint-container',
  imports: [SettingsPage, ManagedTableDialog, ConnectionDialog, ConfirmDialog],
  templateUrl: './settings-table-maint-container.html',
  styleUrl: './settings-section.css',
})
export class SettingsTableMaintContainer {
  private admin = inject(AdminApi);
  private tablesApi = inject(TablesApi);
  private transloco = inject(TranslocoService);

  protected readonly visibleTabs = signal<SettingsTab[]>(['tables', 'connections']);
  protected readonly tab = signal<SettingsTab>('tables');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly tables = signal<ManagedTable[]>([]);
  private readonly connections = signal<Connection[]>([]);
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

  protected readonly connDialogOpen = signal(false);
  protected readonly connDialogMode = signal<'create' | 'edit'>('create');
  protected readonly connDraft = signal<ConnectionDraft | null>(null);
  protected readonly connDialogError = signal<string | null>(null);
  protected readonly connDialogTestResult = signal<string | null>(null);
  protected readonly connTesting = signal(false);
  private editingConnId: number | null = null;

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
      const [tables, connections] = await Promise.all([
        this.tablesApi.listTables(true),
        this.admin.listConnections(),
      ]);
      this.tables.set(tables);
      this.connections.set(connections);
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
   * 接続・実テーブルは固定で，表示名/説明/列モードだけ変更できる。
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
      fixedColumns: t.fixedColumns ?? [],
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
          fixedColumns: e.fixedColumns,
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
