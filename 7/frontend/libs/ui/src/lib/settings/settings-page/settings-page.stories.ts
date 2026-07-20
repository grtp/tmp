import type { Meta, StoryObj } from '@storybook/angular';
import { SettingsPage } from './settings-page';

const actions = [
  { id: 1, code: 'table-maint', name: 'テーブルメンテナンス', icon: 'table', sortOrder: 1, enabled: true, isBuiltin: true },
  { id: 2, code: 'settings', name: '設定', icon: 'settings', sortOrder: 2, enabled: true, isBuiltin: true },
];

const managedTables = [
  { id: 1, schemaName: 'dbo', tableName: 'products', displayName: '商品マスタ', description: 'rowversion あり', sortOrder: 1, enabled: true },
  { id: 2, schemaName: 'dbo', tableName: 'customers', displayName: '取引先マスタ', sortOrder: 2, enabled: true },
  { id: 5, schemaName: 'dbo', tableName: 'materials', displayName: '資材マスタ', connectionName: '生産管理DB', sortOrder: 3, enabled: true },
];

const connections = [
  { id: 1, name: '生産管理DB', host: 'db2.example.local', port: 1433, databaseName: 'seisan', username: 'svc_ftool', enabled: true },
  { id: 2, name: '検証環境DB', host: 'db-test.example.local', port: 1433, databaseName: 'sandbox', username: 'svc_ftool', enabled: false },
];

const users = [
  {
    objectGuid: '00000000-0000-0000-0000-000000000001',
    username: 'local',
    displayName: '田中 太郎',
    lastLoginAt: '2026-07-08 09:12',
    levels: { 1: 'admin', 2: 'admin' } as Record<number, string>,
  },
  {
    objectGuid: '00000000-0000-0000-0000-000000000002',
    username: 'suzuki',
    displayName: '鈴木 次郎',
    lastLoginAt: '2026-07-07 17:44',
    levels: { 1: 'maintainer' } as Record<number, string>,
  },
  {
    objectGuid: '00000000-0000-0000-0000-000000000003',
    username: 'sato',
    displayName: '佐藤 花子',
    levels: { 1: 'user' } as Record<number, string>,
  },
];

const dashTemplates = [
  { id: 1, name: '製造標準', description: 'テーブルメンテ + 生産ポータル', enabled: true },
  { id: 2, name: '品証向け', description: '検査系のみ', enabled: false },
];

const meta: Meta<SettingsPage> = {
  title: 'Pages/Settings',
  component: SettingsPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    tabChanged: { action: 'tabChanged' },
    registerClicked: { action: 'registerClicked' },
    tableToggled: { action: 'tableToggled' },
    tableDeleteClicked: { action: 'tableDeleteClicked' },
    connectionAddClicked: { action: 'connectionAddClicked' },
    connectionEditClicked: { action: 'connectionEditClicked' },
    connectionToggled: { action: 'connectionToggled' },
    connectionDeleteClicked: { action: 'connectionDeleteClicked' },
    connectionTestClicked: { action: 'connectionTestClicked' },
    userLevelChanged: { action: 'userLevelChanged' },
    actionToggled: { action: 'actionToggled' },
    actionDeleteClicked: { action: 'actionDeleteClicked' },
    templateAddClicked: { action: 'templateAddClicked' },
    templateEditClicked: { action: 'templateEditClicked' },
    templateToggled: { action: 'templateToggled' },
    templateDeleteClicked: { action: 'templateDeleteClicked' },
  },
};
export default meta;

type Story = StoryObj<SettingsPage>;

/** 管理テーブルタブ(接続先バッジ付き) */
export const Tables: Story = {
  args: { activeTab: 'tables', managedTables, connections, users, actions },
};

/** 接続タブ(テスト結果の表示例あり) */
export const Connections: Story = {
  args: {
    activeTab: 'connections',
    managedTables,
    connections,
    users,
    actions,
    testResults: { 1: 'OK (12ms)', 2: '接続できません: login error' },
  },
};

/** ユーザー権限マトリクス */
export const Users: Story = {
  args: { activeTab: 'users', managedTables, connections, users, actions },
};

/** 機能マスタ(組込は削除不可。settings 行は有効/無効の操作なし) */
export const Actions: Story = {
  args: { activeTab: 'actions', managedTables, connections, users, actions },
};

/** ダッシュボードテンプレート一覧 */
export const Templates: Story = {
  args: { activeTab: 'templates', managedTables, connections, users, actions, dashTemplates },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { activeTab: 'tables', loading: true },
};
