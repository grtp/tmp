import type { Meta, StoryObj } from '@storybook/angular';
import { DashboardPage, DashboardFunction } from './dashboard-page';

const baseFunctions: DashboardFunction[] = [
  { id: 'item-master', name: '品目マスタ', icon: 'database', permission: 'edit' },
  { id: 'process-master', name: '工程マスタ', icon: 'building-factory-2', permission: 'view' },
  { id: 'hulft-config', name: 'HULFT設定', icon: 'exchange', permission: 'none' },
];

const meta: Meta<DashboardPage> = {
  title: 'Pages/Dashboard',
  component: DashboardPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    functionSelected: { action: 'functionSelected' },
    menuSelected: { action: 'menuSelected' },
    linkSelected: { action: 'linkSelected' },
    linkAddClicked: { action: 'linkAddClicked' },
    linkEditClicked: { action: 'linkEditClicked' },
    linkDeleteClicked: { action: 'linkDeleteClicked' },
  },
  args: {
    userName: '山田太郎',
    greeting: 'おはようございます、山田太郎さん',
    menuItems: [
      { id: 'home', label: 'ホーム', icon: 'home' },
      { id: 'history', label: '操作履歴', icon: 'history' },
      { id: 'logout', label: 'ログアウト', icon: 'logout' },
    ],
    functions: baseFunctions,
  },
};
export default meta;

type Story = StoryObj<DashboardPage>;

/** 標準: 編集可 / 参照のみ / 権限なし が混在 */
export const Default: Story = {};

/** 管理者: 全機能に編集権限あり */
export const AdminUser: Story = {
  args: {
    userName: '管理者',
    functions: baseFunctions.map((f) => ({ ...f, permission: 'edit' as const })),
  },
};

/** 参照専用ユーザー */
export const ReadOnlyUser: Story = {
  args: {
    functions: baseFunctions.map((f) => ({ ...f, permission: 'view' as const })),
  },
};

/** 初回ログイン直後 (自動登録済みだが権限未付与) */
export const NoPermissions: Story = {
  args: {
    functions: [],
  },
};

/** 個人リンクカード付き(ホバーで編集/削除、末尾に追加カード) */
export const WithPersonalLinks: Story = {
  args: {
    personalLinks: [
      { id: 1, name: '社内Wiki', url: 'https://wiki.example.local/', icon: 'external-link' },
      { id: 2, name: '勤怠システム', url: 'https://kintai.example.local/', icon: 'clock' },
    ],
  },
};

/** 機能数が多い場合のグリッド折り返し確認 */
export const ManyFunctions: Story = {
  args: {
    functions: [
      ...baseFunctions,
      { id: 'lot-master', name: 'ロットマスタ', icon: 'stack-2', permission: 'edit' },
      { id: 'inspection', name: '受入検査項目', icon: 'checklist', permission: 'view' },
      { id: 'user-admin', name: 'ユーザー管理', icon: 'users', permission: 'none' },
      { id: 'export', name: 'CSVエクスポート', icon: 'download', permission: 'edit' },
    ],
  },
};
