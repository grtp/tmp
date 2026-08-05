import type { Meta, StoryObj } from '@storybook/angular';
import { AppShell } from './app-shell';

const meta: Meta<AppShell> = {
  title: 'Parts/AppShell',
  component: AppShell,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    menuSelected: { action: 'menuSelected' },
  },
};
export default meta;

type Story = StoryObj<AppShell>;

/** 全画面共通のヘッダー+サイドバー */
export const Default: Story = {
  args: {
    userName: '山田太郎',
    activeMenuId: 'tables',
    menuItems: [
      { id: 'home', label: 'ホーム', icon: 'home' },
      { id: 'tables', label: 'テーブル管理', icon: 'table_view' },
      { id: 'history', label: '操作履歴', icon: 'history' },
      { id: 'settings', label: '設定', icon: 'settings' },
    ],
  },
};
