import type { Meta, StoryObj } from '@storybook/angular';
import { SettingsPage } from './settings-page';

const actions = [
  {
    id: 1,
    code: 'table-maint',
    name: 'テーブルメンテナンス',
    icon: 'table_view',
    sortOrder: 1,
    enabled: true,
  },
  {
    id: 2,
    code: 'settings',
    name: '設定',
    icon: 'settings',
    sortOrder: 2,
    enabled: true,
  },
];

const managedTables = [
  {
    id: 1,
    schemaName: 'dbo',
    tableName: 'products',
    displayName: '商品マスタ',
    description: 'rowversion あり',
    sortOrder: 1,
    enabled: true,
  },
  {
    id: 2,
    schemaName: 'dbo',
    tableName: 'customers',
    displayName: '取引先マスタ',
    sortOrder: 2,
    enabled: true,
  },
  {
    id: 5,
    schemaName: 'dbo',
    tableName: 'materials',
    displayName: '資材マスタ',
    connectionName: '生産管理DB',
    sortOrder: 3,
    enabled: true,
  },
];

const connections = [
  {
    id: 1,
    name: '生産管理DB',
    host: 'db2.example.local',
    port: 1433,
    databaseName: 'seisan',
    username: 'svc_ftool',
    enabled: true,
  },
  {
    id: 2,
    name: '検証環境DB',
    host: 'db-test.example.local',
    port: 1433,
    databaseName: 'sandbox',
    username: 'svc_ftool',
    enabled: false,
  },
];

const dashTemplates = [
  {
    id: 1,
    name: '製造標準',
    description: 'テーブルメンテ + 生産ポータル',
    enabled: true,
  },
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
    actionToggled: { action: 'actionToggled' },
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
  args: { activeTab: 'tables', managedTables, connections, actions },
};

/** 接続タブ(テスト結果の表示例あり) */
export const Connections: Story = {
  args: {
    activeTab: 'connections',
    managedTables,
    connections,
    actions,
  },
};

/** 機能マスタ(組込は削除不可。settings 行は有効/無効の操作なし) */
export const Actions: Story = {
  args: { activeTab: 'actions', managedTables, connections, actions },
};

/** ダッシュボードテンプレート一覧 */
export const Templates: Story = {
  args: {
    activeTab: 'templates',
    managedTables,
    connections,
    actions,
    dashTemplates,
  },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { activeTab: 'tables', loading: true },
};
