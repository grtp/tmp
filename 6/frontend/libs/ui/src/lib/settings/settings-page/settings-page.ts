import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { TmResizeColumnsDirective } from '../../shared/resize-columns/resize-columns.directive';

export type SettingsTab = 'tables' | 'connections' | 'users' | 'actions' | 'templates';

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
  isBuiltin: boolean;
}

export interface SettingsUser {
  objectGuid: string;
  username: string;
  displayName: string;
  lastLoginAt?: string;
  /** actionId -> level ('' = 権限なし) */
  levels: Record<number, string>;
}

export interface UserLevelChange {
  objectGuid: string;
  actionId: number;
  /** '' = 権限を外す */
  level: '' | 'user' | 'maintainer' | 'admin';
}

/**
 * 設定画面(admin)。タブ構成:
 *   - tables      : 管理対象テーブルの登録/表示切替/解除
 *   - connections : 接続先 SQL Server の管理
 *   - users       : ユーザー x 機能 の権限マトリクス編集
 *   - actions     : 機能マスタ(ダッシュボードカード)の編集
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-page',
  imports: [TranslocoPipe, TmResizeColumnsDirective],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  readonly activeTab = input<SettingsTab>('tables');
  /** 表示するタブ(1つならタブバー非表示)。セクション分割ルーティング用 */
  readonly visibleTabs = input<SettingsTab[]>(['tables', 'connections', 'users', 'actions', 'templates']);
  readonly dashTemplates = input<SettingsDashTemplate[]>([]);
  readonly managedTables = input<SettingsManagedTable[]>([]);
  readonly connections = input<SettingsConnection[]>([]);
  /** 接続テスト結果の表示("OK (12ms)" / エラーメッセージ)。id キー */
  readonly testResults = input<Record<number, string>>({});
  readonly users = input<SettingsUser[]>([]);
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
  readonly userLevelChanged = output<UserLevelChange>();
  readonly actionToggled = output<{ id: number; enabled: boolean }>();
  readonly actionDeleteClicked = output<number>();
  readonly templateAddClicked = output<void>();
  readonly templateEditClicked = output<number>();
  readonly templateToggled = output<{ id: number; enabled: boolean }>();
  readonly templateDeleteClicked = output<number>();

  protected tabIcon(t: SettingsTab): string {
    switch (t) {
      case 'tables':
        return 'table';
      case 'connections':
        return 'plug';
      case 'users':
        return 'users';
      case 'actions':
        return 'apps';
      case 'templates':
        return 'layout-dashboard';
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

  protected levelOf(u: SettingsUser, actionId: number): string {
    return u.levels[actionId] || '';
  }
}
