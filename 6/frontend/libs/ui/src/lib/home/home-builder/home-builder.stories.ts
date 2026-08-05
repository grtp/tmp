import type { Meta, StoryObj } from '@storybook/angular';
import { HomeBuilder } from './home-builder';

const meta: Meta<HomeBuilder> = {
  title: 'Pages/HomeBuilder',
  component: HomeBuilder,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    widgetsChanged: { action: 'widgetsChanged' },
    saveClicked: { action: 'saveClicked' },
    resetClicked: { action: 'resetClicked' },
    jsonApplied: { action: 'jsonApplied' },
  },
};
export default meta;

type Story = StoryObj<HomeBuilder>;

const requiresOptions = [
  { code: 'tables', label: 'テーブル管理' },
  { code: 'history', label: '操作履歴' },
  { code: 'settings', label: '設定' },
];

/** 編集中の構成(未保存の変更あり) */
export const Editing: Story = {
  args: {
    requiresOptions,
    dirty: true,
    widgets: [
      {
        type: 'hero',
        size: 3,
        title: 'F-tool ポータル',
        subtitle: '運用業務の入り口',
        links: [
          { label: 'テーブル管理', url: '/tables', icon: 'table_view' },
          { label: '社内ポータル', url: 'https://portal.example.com', icon: 'language' },
        ],
      },
      { type: 'note', size: 2, tone: 'warn', text: 'メンテナンス告知をここに表示' },
      {
        type: 'pills',
        size: 1,
        title: 'ショートカット',
        items: [{ label: '在庫一覧', url: '/tables/1', icon: 'inventory_2' }],
      },
      {
        type: 'rows',
        size: 2,
        title: '管理者リンク',
        requires: 'settings',
        items: [
          { label: 'ユーザー権限', url: '/settings/users', icon: 'group', desc: '権限マトリクス' },
        ],
      },
    ],
  },
};

/** 空のキャンバス(初期状態) */
export const Empty: Story = {
  args: {
    requiresOptions,
    widgets: [],
  },
};
