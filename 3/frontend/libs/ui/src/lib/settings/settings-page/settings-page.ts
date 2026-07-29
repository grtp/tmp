import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import {
  CellContext,
  ColumnDef,
  DataTablePage,
  TableRow,
} from '../../table-maint/data-table-page/data-table-page';


export type SettingsTab =
  | 'tables'
  | 'connections'
  | 'users'
  | 'actions'
  | 'templates';

export interface SettingsDashTemplate {
  id: number;
  name: string;
  description?: string;
  enabled: boolean;
}

export interface SettingsManagedTable {
  id: number;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
  /** 接続の表示名(既定DBは undefined) */
  connectionName?: string;
  sortOrder: number;
  enabled: boolean;
}

export interface SettingsConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  /** スキーマ制限(空 = 制限なし) */
  schemaName?: string;
  enabled: boolean;
}

export interface SettingsAction {
  id: number;
  code: string;
  name: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

/** 表示行に埋め込む元データ参照キー(列に無いので描画されない)。 */
const ROW_INDEX_KEY = '$i';

/**
 * 設定画面(admin)。タブ構成:
 *   - tables      : 管理対象テーブルの登録/表示切替/解除
 *   - connections : 接続先 SQL Server の管理
 *   - actions     : 機能マスタ(ダッシュボードカード)の編集
 *   - templates   : ダッシュボードテンプレート
 * 各タブの一覧は共有グリッド(tm-data-table-page)ベースで,バッジ/
 * チェック/操作ボタンはセルテンプレートで注入する。
 * ユーザー権限(users)は tm-users-grid が担い,ここにはタブ種別としてだけ残る。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-page',
  imports: [
    DataTablePage,
    MatButtonModule,
    MatCheckboxModule,
    MatIcon,
    MatTabsModule,
    TranslocoPipe,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  readonly activeTab = input<SettingsTab>('tables');
  /** 表示するタブ(1つならタブバー非表示)。セクション分割ルーティング用 */
  readonly visibleTabs = input<SettingsTab[]>([
    'tables',
    'connections',
    'users',
    'actions',
    'templates',
  ]);
  readonly dashTemplates = input<SettingsDashTemplate[]>([]);
  readonly managedTables = input<SettingsManagedTable[]>([]);
  readonly connections = input<SettingsConnection[]>([]);
  readonly actions = input<SettingsAction[]>([]);
  readonly loading = input(false);

  readonly tabChanged = output<SettingsTab>();
  readonly registerClicked = output<void>();
  /** 管理テーブル行クリック(編集ダイアログを開く) */
  readonly tableEditClicked = output<number>();
  readonly tableToggled = output<{ id: number; enabled: boolean }>();
  readonly tableDeleteClicked = output<number>();
  readonly connectionAddClicked = output<void>();
  readonly connectionEditClicked = output<number>();
  readonly connectionToggled = output<{ id: number; enabled: boolean }>();
  readonly connectionDeleteClicked = output<number>();
  readonly connectionTestClicked = output<number>();
  readonly actionToggled = output<{ id: number; enabled: boolean }>();
  readonly templateAddClicked = output<void>();
  readonly templateEditClicked = output<number>();
  readonly templateToggled = output<{ id: number; enabled: boolean }>();
  readonly templateDeleteClicked = output<number>();

  protected tabIcon(t: SettingsTab): string {
    switch (t) {
      case 'tables':
        return 'table_view';
      case 'connections':
        return 'cable';
      case 'users':
        return 'group';
      case 'actions':
        return 'apps';
      case 'templates':
        return 'dashboard';
    }
  }

  protected tabLabelKey(t: SettingsTab): string {
    switch (t) {
      case 'tables':
        return 'settings.tabTables';
      case 'connections':
        return 'settings.tabConnections';
      case 'users':
        return 'settings.tabUsers';
      case 'actions':
        return 'settings.tabActions';
      case 'templates':
        return 'settings.tabTemplates';
    }
  }

  private transloco = inject(TranslocoService);
  // 辞書ロード完了/言語切替で列見出しを再評価する
  private readonly lang = toSignal(this.transloco.selectTranslation());

  private t(key: string): string {
    void this.lang();
    return this.transloco.translate(key);
  }

  // ---- セルテンプレート(html 側で宣言。タブがアクティブな間だけ解決される) ----
  private readonly tableConnTpl = viewChild<TemplateRef<CellContext>>('tableConnTpl');
  private readonly tableVisibleTpl = viewChild<TemplateRef<CellContext>>('tableVisibleTpl');
  private readonly tableOpsTpl = viewChild<TemplateRef<CellContext>>('tableOpsTpl');
  private readonly connEnabledTpl = viewChild<TemplateRef<CellContext>>('connEnabledTpl');
  private readonly connOpsTpl = viewChild<TemplateRef<CellContext>>('connOpsTpl');
  private readonly actionIconTpl = viewChild<TemplateRef<CellContext>>('actionIconTpl');
  private readonly actionEnabledTpl = viewChild<TemplateRef<CellContext>>('actionEnabledTpl');
  private readonly dashEnabledTpl = viewChild<TemplateRef<CellContext>>('dashEnabledTpl');
  private readonly dashOpsTpl = viewChild<TemplateRef<CellContext>>('dashOpsTpl');

  /** 表示行($i 付き)から元データを解決する。 */
  private atIndex<T>(list: T[], row: TableRow): T | undefined {
    const i = row[ROW_INDEX_KEY];
    return typeof i === 'number' ? list[i] : undefined;
  }

  protected tableOf(row: TableRow): SettingsManagedTable | undefined {
    return this.atIndex(this.managedTables(), row);
  }

  protected connOf(row: TableRow): SettingsConnection | undefined {
    return this.atIndex(this.connections(), row);
  }

  protected actionOf(row: TableRow): SettingsAction | undefined {
    return this.atIndex(this.actions(), row);
  }

  protected dashOf(row: TableRow): SettingsDashTemplate | undefined {
    return this.atIndex(this.dashTemplates(), row);
  }

  // ---- 管理テーブルタブ ----
  protected readonly tablesCols = computed<ColumnDef[]>(() => [
    { key: 'displayName', label: this.t('settings.thDisplayName') },
    { key: 'conn', label: this.t('settings.thConnection'), template: this.tableConnTpl() },
    { key: 'physical', label: this.t('settings.thPhysicalTable'), mono: true },
    { key: 'description', label: this.t('settings.thDescription') },
    { key: 'enabled', label: this.t('settings.thVisible'), template: this.tableVisibleTpl() },
    { key: 'ops', label: this.t('settings.thOps'), template: this.tableOpsTpl() },
  ]);

  protected readonly tablesRows = computed<TableRow[]>(() =>
    this.managedTables().map((t, i) => ({
      [ROW_INDEX_KEY]: i,
      displayName: t.displayName,
      conn: '',
      physical: `${t.schemaName}.${t.tableName}`,
      description: t.description ?? '',
      enabled: '',
      ops: '',
    })),
  );

  /** 行クリック = 編集ダイアログ(チェック・削除はセル側で伝播を止める)。 */
  protected onTableRowSelected(row: TableRow): void {
    const t = this.tableOf(row);
    if (t) this.tableEditClicked.emit(t.id);
  }

  protected onConnRowSelected(row: TableRow): void {
    const cn = this.connOf(row);
    if (cn) this.connectionEditClicked.emit(cn.id);
  }

  protected onDashRowSelected(row: TableRow): void {
    const t = this.dashOf(row);
    if (t) this.templateEditClicked.emit(t.id);
  }

  // ---- 接続タブ ----
  protected readonly connectionsCols = computed<ColumnDef[]>(() => [
    { key: 'name', label: this.t('settings.thName') },
    { key: 'host', label: this.t('settings.thHost'), mono: true },
    { key: 'databaseName', label: this.t('settings.thDatabase'), mono: true },
    { key: 'username', label: this.t('settings.thUsername'), mono: true },
    { key: 'schema', label: this.t('settings.thSchema'), mono: true },
    { key: 'enabled', label: this.t('settings.thEnabled'), template: this.connEnabledTpl() },
    { key: 'ops', label: this.t('settings.thOps'), template: this.connOpsTpl() },
  ]);

  protected readonly connectionsRows = computed<TableRow[]>(() =>
    this.connections().map((cn, i) => ({
      [ROW_INDEX_KEY]: i,
      name: cn.name,
      host: `${cn.host}:${cn.port}`,
      databaseName: cn.databaseName,
      username: cn.username,
      schema: cn.schemaName || this.t('settings.schemaUnrestricted'),
      enabled: '',
      ops: '',
    })),
  );

  // ---- 機能マスタタブ ----
  protected readonly actionsCols = computed<ColumnDef[]>(() => [
    { key: 'code', label: this.t('settings.thCode'), mono: true },
    { key: 'name', label: this.t('settings.thName') },
    { key: 'icon', label: this.t('settings.thIcon'), template: this.actionIconTpl() },
    { key: 'enabled', label: this.t('settings.thEnabled'), template: this.actionEnabledTpl() },
  ]);

  protected readonly actionsRows = computed<TableRow[]>(() =>
    this.actions().map((a, i) => ({
      [ROW_INDEX_KEY]: i,
      code: a.code,
      name: a.name,
      icon: '',
      enabled: '',
    })),
  );

  // ---- テンプレートタブ ----
  protected readonly templatesCols = computed<ColumnDef[]>(() => [
    { key: 'name', label: this.t('settings.thTemplateName') },
    { key: 'description', label: this.t('settings.thDescription') },
    { key: 'enabled', label: this.t('settings.thEnabled'), template: this.dashEnabledTpl() },
    { key: 'ops', label: this.t('settings.thOps'), template: this.dashOpsTpl() },
  ]);

  protected readonly templatesRows = computed<TableRow[]>(() =>
    this.dashTemplates().map((t, i) => ({
      [ROW_INDEX_KEY]: i,
      name: t.name,
      description: t.description ?? '',
      enabled: '',
      ops: '',
    })),
  );
}
