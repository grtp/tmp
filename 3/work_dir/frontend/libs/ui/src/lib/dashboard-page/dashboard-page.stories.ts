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
  },
  args: {
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
