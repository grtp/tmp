import type { Meta, StoryObj } from '@storybook/angular';
import { UsersGrid } from './users-grid';

const actions = [
  { id: 1, code: 'tables', name: 'テーブル管理' },
  { id: 2, code: 'history', name: '操作履歴' },
  { id: 3, code: 'settings', name: '設定' },
];

const users = [
  {
    objectGuid: '00000000-0000-0000-0000-000000000001',
    username: 'local',
    displayName: '田中 太郎',
    lastLoginAt: '2026-07-08 09:12',
    levels: { 1: 'admin', 2: 'admin', 3: 'admin' } as Record<number, string>,
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

const meta: Meta<UsersGrid> = {
  title: 'Pages/UsersGrid',
  component: UsersGrid,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    levelChanged: { action: 'levelChanged' },
    predicatesChange: { action: 'predicatesChange' },
    pageChanged: { action: 'pageChanged' },
    pageSizeChanged: { action: 'pageSizeChanged' },
  },
  args: {
    users,
    actions,
    totalCount: 3,
    page: 1,
    pageSize: 50,
  },
};
export default meta;

type Story = StoryObj<UsersGrid>;

/** ユーザー権限マトリクス(機能列は actions から動的生成) */
export const Default: Story = {};

/** 検索結果 0 件 */
export const Empty: Story = {
  args: { users: [], totalCount: 0 },
};
