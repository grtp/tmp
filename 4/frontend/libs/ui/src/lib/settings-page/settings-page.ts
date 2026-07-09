import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type SettingsTab = 'tables' | 'connections' | 'users' | 'actions';

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
  imports: [TranslocoPipe],
  template: `
    <div class="panel">
      @if (visibleTabs().length > 1) {
        <div class="tabs" role="tablist">
          @for (t of visibleTabs(); track t) {
            <button class="tab" type="button" role="tab"
              [class.active]="activeTab() === t" (click)="tabChanged.emit(t)">
              <i class="ti ti-{{ tabIcon(t) }}" aria-hidden="true"></i> {{ tabLabelKey(t) | transloco }}
            </button>
          }
        </div>
      }

      @if (loading()) {
        <p class="state">{{ 'common.loading' | transloco }}</p>
      } @else {
        @switch (activeTab()) {
          @case ('tables') {
            <div class="toolbar">
              <button class="btn primary" type="button" (click)="registerClicked.emit()">
                <i class="ti ti-table-plus" aria-hidden="true"></i> {{ 'settings.registerTable' | transloco }}
              </button>
            </div>
            <table class="table">
              <thead>
                <tr>
                  <th>{{ 'settings.thDisplayName' | transloco }}</th>
                  <th>{{ 'settings.thConnection' | transloco }}</th>
                  <th>{{ 'settings.thPhysicalTable' | transloco }}</th>
                  <th>{{ 'settings.thDescription' | transloco }}</th>
                  <th class="w80">{{ 'settings.thVisible' | transloco }}</th>
                  <th class="w80">{{ 'settings.thOps' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (t of managedTables(); track t.id) {
                  <tr>
                    <td>{{ t.displayName }}</td>
                    <td>
                      @if (t.connectionName) {
                        <span class="conn-badge">{{ t.connectionName }}</span>
                      } @else {
                        <span class="muted">{{ 'common.defaultDb' | transloco }}</span>
                      }
                    </td>
                    <td class="mono">{{ t.schemaName }}.{{ t.tableName }}</td>
                    <td class="muted">{{ t.description }}</td>
                    <td>
                      <input type="checkbox" [checked]="t.enabled"
                        (change)="tableToggled.emit({ id: t.id, enabled: $any($event.target).checked })" />
                    </td>
                    <td>
                      <button class="icon-btn danger" type="button" (click)="tableDeleteClicked.emit(t.id)"
                        [attr.aria-label]="'settings.unregisterAria' | transloco">
                        <i class="ti ti-trash" aria-hidden="true"></i>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td class="state" colspan="6">{{ 'settings.tablesEmpty' | transloco }}</td></tr>
                }
              </tbody>
            </table>
          }

          @case ('connections') {
            <div class="toolbar">
              <button class="btn primary" type="button" (click)="connectionAddClicked.emit()">
                <i class="ti ti-plug" aria-hidden="true"></i> {{ 'settings.addConnection' | transloco }}
              </button>
            </div>
            <table class="table">
              <thead>
                <tr>
                  <th>{{ 'settings.thName' | transloco }}</th>
                  <th>{{ 'settings.thHost' | transloco }}</th>
                  <th>{{ 'settings.thDatabase' | transloco }}</th>
                  <th>{{ 'settings.thUsername' | transloco }}</th>
                  <th class="w80">{{ 'settings.thEnabled' | transloco }}</th>
                  <th class="w200">{{ 'settings.thOps' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (cn of connections(); track cn.id) {
                  <tr>
                    <td>{{ cn.name }}</td>
                    <td class="mono">{{ cn.host }}:{{ cn.port }}</td>
                    <td class="mono">{{ cn.databaseName }}</td>
                    <td class="mono">{{ cn.username }}</td>
                    <td>
                      <input type="checkbox" [checked]="cn.enabled"
                        (change)="connectionToggled.emit({ id: cn.id, enabled: $any($event.target).checked })" />
                    </td>
                    <td>
                      <span class="ops">
                        <button class="btn small" type="button" (click)="connectionTestClicked.emit(cn.id)">
                          {{ 'settings.testConnection' | transloco }}
                        </button>
                        <button class="icon-btn" type="button" (click)="connectionEditClicked.emit(cn.id)"
                          [attr.aria-label]="'settings.editAria' | transloco">
                          <i class="ti ti-pencil" aria-hidden="true"></i>
                        </button>
                        <button class="icon-btn danger" type="button" (click)="connectionDeleteClicked.emit(cn.id)"
                          [attr.aria-label]="'settings.deleteAria' | transloco">
                          <i class="ti ti-trash" aria-hidden="true"></i>
                        </button>
                        @if (testResults()[cn.id]; as result) {
                          <span class="test-result" [class.ng]="!result.startsWith('OK')">{{ result }}</span>
                        }
                      </span>
                    </td>
                  </tr>
                } @empty {
                  <tr><td class="state" colspan="6">{{ 'settings.connectionsEmpty' | transloco }}</td></tr>
                }
              </tbody>
            </table>
          }

          @case ('users') {
            <table class="table">
              <thead>
                <tr>
                  <th>{{ 'settings.thUser' | transloco }}</th>
                  @for (a of actions(); track a.id) {
                    <th class="w140">{{ a.name }}</th>
                  }
                  <th>{{ 'settings.thLastLogin' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (u of users(); track u.objectGuid) {
                  <tr>
                    <td>
                      <span class="user-name">{{ u.displayName }}</span>
                      <span class="muted mono"> {{ u.username }}</span>
                    </td>
                    @for (a of actions(); track a.id) {
                      <td>
                        <select
                          class="level"
                          [value]="levelOf(u, a.id)"
                          (change)="userLevelChanged.emit({
                            objectGuid: u.objectGuid,
                            actionId: a.id,
                            level: $any($event.target).value
                          })"
                        >
                          <option value="">{{ 'settings.levelNone' | transloco }}</option>
                          <option value="user">{{ 'settings.levelUser' | transloco }}</option>
                          <option value="maintainer">{{ 'settings.levelMaintainer' | transloco }}</option>
                          <option value="admin">{{ 'settings.levelAdmin' | transloco }}</option>
                        </select>
                      </td>
                    }
                    <td class="muted">{{ u.lastLoginAt ?? '-' }}</td>
                  </tr>
                } @empty {
                  <tr><td class="state" [attr.colspan]="actions().length + 2">{{ 'settings.usersEmpty' | transloco }}</td></tr>
                }
              </tbody>
            </table>
          }

          @case ('actions') {
            <!-- 組込機能の表示編集のみ。機能の追加はコード実装 + シードで行い、
                 任意 URL のカードは各ユーザーがダッシュボードの個人リンクで持つ。 -->
            <table class="table">
              <thead>
                <tr>
                  <th class="w140">{{ 'settings.thCode' | transloco }}</th>
                  <th>{{ 'settings.thName' | transloco }}</th>
                  <th class="w80">{{ 'settings.thIcon' | transloco }}</th>
                  <th class="w80">{{ 'settings.thEnabled' | transloco }}</th>
                  <th class="w80">{{ 'settings.thOps' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (a of actions(); track a.id) {
                  <tr>
                    <td class="mono">{{ a.code }}</td>
                    <td>{{ a.name }}</td>
                    <td><i class="ti ti-{{ a.icon }}" aria-hidden="true"></i> <span class="muted">{{ a.icon }}</span></td>
                    <td>
                      <input type="checkbox" [checked]="a.enabled"
                        (change)="actionToggled.emit({ id: a.id, enabled: $any($event.target).checked })" />
                    </td>
                    <td>
                      @if (a.isBuiltin) {
                        <span class="muted">{{ 'settings.builtin' | transloco }}</span>
                      } @else {
                        <button class="icon-btn danger" type="button" (click)="actionDeleteClicked.emit(a.id)"
                          [attr.aria-label]="'settings.deleteAria' | transloco">
                          <i class="ti ti-trash" aria-hidden="true"></i>
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
    </div>
  `,
  styles: `
    .panel {
      background: var(--tm-surface);
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      overflow: hidden;
      margin: 16px;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--tm-border);
      background: var(--tm-surface-alt);
    }
    .tab {
      padding: 10px 16px;
      border: none;
      background: transparent;
      font-size: 13px;
      font-family: inherit;
      color: var(--tm-text-secondary);
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .tab.active {
      color: var(--tm-primary);
      border-bottom-color: var(--tm-primary);
      background: var(--tm-surface);
      font-weight: 600;
    }
    .toolbar {
      padding: 10px 12px;
      border-bottom: 1px solid var(--tm-border);
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .btn {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      color: var(--tm-text);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .btn.primary {
      background: var(--tm-primary);
      border-color: var(--tm-primary);
      color: var(--tm-text-on-primary);
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--tm-primary-dark);
    }
    .btn.small {
      height: 26px;
      padding: 0 8px;
      font-size: 11px;
    }
    .input {
      height: 32px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      color: var(--tm-text);
      flex: 1;
    }
    .input:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .w80 {
      width: 80px;
    }
    .w140 {
      width: 140px;
    }
    .w200 {
      width: 220px;
    }
    .new-action .w140 {
      flex: 0 0 140px;
    }
    .grow2 {
      flex: 2;
    }
    .kind-badge {
      font-size: 10px;
      border-radius: 3px;
      padding: 1px 6px;
    }
    .kind-badge.builtin {
      background: var(--tm-surface-alt);
      color: var(--tm-text-secondary);
    }
    .kind-badge.link {
      background: var(--tm-primary-tint);
      color: var(--tm-primary);
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      background: var(--tm-surface-alt);
      color: var(--tm-text-secondary);
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--tm-border);
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--tm-border);
    }
    .mono {
      font-family: var(--tm-font-mono);
    }
    .muted {
      color: var(--tm-text-muted);
    }
    .conn-badge {
      font-size: 11px;
      background: var(--tm-primary-tint);
      color: var(--tm-primary);
      border-radius: 3px;
      padding: 1px 6px;
    }
    .user-name {
      font-weight: 600;
    }
    .level {
      height: 28px;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      color: var(--tm-text);
      width: 100%;
    }
    .ops {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .test-result {
      font-size: 11px;
      color: var(--tm-primary);
    }
    .test-result.ng {
      color: var(--tm-danger);
    }
    .icon-btn {
      border: 1px solid var(--tm-border);
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: 26px;
      height: 26px;
      cursor: pointer;
      color: var(--tm-text-secondary);
    }
    .icon-btn.danger {
      color: var(--tm-danger);
      border-color: var(--tm-danger);
    }
    .icon-btn.danger:hover {
      background: var(--tm-danger-bg);
    }
    .state {
      text-align: center;
      color: var(--tm-text-muted);
      padding: 28px 10px;
    }
    p.state {
      margin: 0;
    }
  `,
})
export class SettingsPage {
  readonly activeTab = input<SettingsTab>('tables');
  /** 表示するタブ(1つならタブバー非表示)。セクション分割ルーティング用 */
  readonly visibleTabs = input<SettingsTab[]>(['tables', 'connections', 'users', 'actions']);
  readonly managedTables = input<SettingsManagedTable[]>([]);
  readonly connections = input<SettingsConnection[]>([]);
  /** 接続テスト結果の表示("OK (12ms)" / エラーメッセージ)。id キー */
  readonly testResults = input<Record<number, string>>({});
  readonly users = input<SettingsUser[]>([]);
  readonly actions = input<SettingsAction[]>([]);
  readonly loading = input(false);

  readonly tabChanged = output<SettingsTab>();
  readonly registerClicked = output<void>();
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
    }
  }

  protected levelOf(u: SettingsUser, actionId: number): string {
    return u.levels[actionId] || '';
  }
}
