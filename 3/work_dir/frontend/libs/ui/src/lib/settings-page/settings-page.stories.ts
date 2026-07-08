import type { Meta, StoryObj } from '@storybook/angular';
import { SettingsPage } from './settings-page';

const actions = [
  { id: 1, code: 'table-maint', name: 'テーブルメンテナンス', icon: 'table', sortOrder: 1, enabled: true, isBuiltin: true },
  { id: 2, code: 'settings', name: '設定', icon: 'settings', sortOrder: 2, enabled: true, isBuiltin: true },
  { id: 3, code: 'hulft-config', name: 'HULFT配信設定', icon: 'transfer', sortOrder: 3, enabled: false, isBuiltin: false },
];

const managedTables = [
  { id: 1, schemaName: 'dbo', tableName: 'products', displayName: '商品マスタ', description: 'rowversion あり', sortOrder: 1, enabled: true },
  { id: 2, schemaName: 'dbo', tableName: 'customers', displayName: '取引先マスタ', sortOrder: 2, enabled: true },
  { id: 3, schemaName: 'dbo', tableName: 'depts', displayName: '部門マスタ', sortOrder: 3, enabled: false },
];

const users = [
  {
    objectGuid: '00000000-0000-0000-0000-000000000001',
    username: 'tanaka',
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
    userLevelChanged: { action: 'userLevelChanged' },
    actionCreated: { action: 'actionCreated' },
    actionToggled: { action: 'actionToggled' },
    actionDeleteClicked: { action: 'actionDeleteClicked' },
  },
};
export default meta;

type Story = StoryObj<SettingsPage>;

/** 管理テーブルタブ */
export const Tables: Story = {
  args: { activeTab: 'tables', managedTables, users, actions },
};

/** ユーザー権限マトリクス */
export const Users: Story = {
  args: { activeTab: 'users', managedTables, users, actions },
};

/** 機能マスタ(組込は削除不可) */
export const Actions: Story = {
  args: { activeTab: 'actions', managedTables, users, actions },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { activeTab: 'tables', loading: true },
};
