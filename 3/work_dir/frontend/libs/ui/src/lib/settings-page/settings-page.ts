import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';

export type SettingsTab = 'tables' | 'users' | 'actions';

export interface SettingsManagedTable {
  id: number;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
  sortOrder: number;
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
 *   - tables : 管理対象テーブルの登録/表示切替/解除
 *   - users  : ユーザー x 機能 の権限マトリクス編集
 *   - actions: 機能マスタ(ダッシュボードカード)の編集
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-settings-page',
  template: `
    <div class="panel">
      <div class="tabs" role="tablist">
        <button
          class="tab"
          type="button"
          role="tab"
          [class.active]="activeTab() === 'tables'"
          (click)="tabChanged.emit('tables')"
        >
          <i class="ti ti-table" aria-hidden="true"></i> 管理テーブル
        </button>
        <button
          class="tab"
          type="button"
          role="tab"
          [class.active]="activeTab() === 'users'"
          (click)="tabChanged.emit('users')"
        >
          <i class="ti ti-users" aria-hidden="true"></i> ユーザー権限
        </button>
        <button
          class="tab"
          type="button"
          role="tab"
          [class.active]="activeTab() === 'actions'"
          (click)="tabChanged.emit('actions')"
        >
          <i class="ti ti-apps" aria-hidden="true"></i> 機能マスタ
        </button>
      </div>

      @if (loading()) {
        <p class="state">読み込み中…</p>
      } @else {
        @switch (activeTab()) {
          @case ('tables') {
            <div class="toolbar">
              <button class="btn primary" type="button" (click)="registerClicked.emit()">
                <i class="ti ti-table-plus" aria-hidden="true"></i> テーブルを登録
              </button>
            </div>
            <table class="table">
              <thead>
                <tr>
                  <th>表示名</th><th>実テーブル</th><th>説明</th>
                  <th class="w80">表示</th><th class="w80">操作</th>
                </tr>
              </thead>
              <tbody>
                @for (t of managedTables(); track t.id) {
                  <tr>
                    <td>{{ t.displayName }}</td>
                    <td class="mono">{{ t.schemaName }}.{{ t.tableName }}</td>
                    <td class="muted">{{ t.description }}</td>
                    <td>
                      <input
                        type="checkbox"
                        [checked]="t.enabled"
                        (change)="tableToggled.emit({ id: t.id, enabled: $any($event.target).checked })"
                      />
                    </td>
                    <td>
                      <button class="icon-btn danger" type="button" (click)="tableDeleteClicked.emit(t.id)" aria-label="登録解除">
                        <i class="ti ti-trash" aria-hidden="true"></i>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td class="state" colspan="5">管理対象テーブルがありません</td></tr>
                }
              </tbody>
            </table>
          }

          @case ('users') {
            <table class="table">
              <thead>
                <tr>
                  <th>ユーザー</th>
                  @for (a of actions(); track a.id) {
                    <th class="w140">{{ a.name }}</th>
                  }
                  <th>最終ログイン</th>
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
                          <option value="">権限なし</option>
                          <option value="user">user (閲覧)</option>
                          <option value="maintainer">maintainer (編集)</option>
                          <option value="admin">admin (管理)</option>
                        </select>
                      </td>
                    }
                    <td class="muted">{{ u.lastLoginAt ?? '-' }}</td>
                  </tr>
                } @empty {
                  <tr><td class="state" [attr.colspan]="actions().length + 2">ユーザーがいません(初回ログインで自動登録されます)</td></tr>
                }
              </tbody>
            </table>
          }

          @case ('actions') {
            <div class="toolbar new-action">
              <input class="input w140" type="text" placeholder="code (例: hulft-config)"
                [value]="newCode()" (input)="newCode.set($any($event.target).value)" />
              <input class="input" type="text" placeholder="機能名"
                [value]="newName()" (input)="newName.set($any($event.target).value)" />
              <input class="input w140" type="text" placeholder="icon (Tabler名)"
                [value]="newIcon()" (input)="newIcon.set($any($event.target).value)" />
              <button class="btn primary" type="button" [disabled]="!canAddAction()" (click)="addAction()">
                <i class="ti ti-plus" aria-hidden="true"></i> 追加
              </button>
            </div>
            <table class="table">
              <thead>
                <tr>
                  <th class="w140">code</th><th>名称</th><th class="w80">icon</th>
                  <th class="w80">有効</th><th class="w80">操作</th>
                </tr>
              </thead>
              <tbody>
                @for (a of actions(); track a.id) {
                  <tr>
                    <td class="mono">{{ a.code }}</td>
                    <td>{{ a.name }}</td>
                    <td><i class="ti ti-{{ a.icon }}" aria-hidden="true"></i> <span class="muted">{{ a.icon }}</span></td>
                    <td>
                      <input
                        type="checkbox"
                        [checked]="a.enabled"
                        (change)="actionToggled.emit({ id: a.id, enabled: $any($event.target).checked })"
                      />
                    </td>
                    <td>
                      @if (a.isBuiltin) {
                        <span class="muted">組込</span>
                      } @else {
                        <button class="icon-btn danger" type="button" (click)="actionDeleteClicked.emit(a.id)" aria-label="削除">
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
    .new-action .w140 {
      flex: 0 0 140px;
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
  readonly managedTables = input<SettingsManagedTable[]>([]);
  readonly users = input<SettingsUser[]>([]);
  readonly actions = input<SettingsAction[]>([]);
  readonly loading = input(false);

  readonly tabChanged = output<SettingsTab>();
  readonly registerClicked = output<void>();
  readonly tableToggled = output<{ id: number; enabled: boolean }>();
  readonly tableDeleteClicked = output<number>();
  readonly userLevelChanged = output<UserLevelChange>();
  readonly actionCreated = output<{ code: string; name: string; icon: string }>();
  readonly actionToggled = output<{ id: number; enabled: boolean }>();
  readonly actionDeleteClicked = output<number>();

  protected readonly newCode = signal('');
  protected readonly newName = signal('');
  protected readonly newIcon = signal('');

  protected levelOf(u: SettingsUser, actionId: number): string {
    return u.levels[actionId] || '';
  }

  protected canAddAction(): boolean {
    return /^[a-z][a-z0-9-]{0,63}$/.test(this.newCode()) && this.newName().trim() !== '';
  }

  protected addAction(): void {
    this.actionCreated.emit({
      code: this.newCode(),
      name: this.newName().trim(),
      icon: this.newIcon().trim() || 'apps',
    });
    this.newCode.set('');
    this.newName.set('');
    this.newIcon.set('');
  }
}
