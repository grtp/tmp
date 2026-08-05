import type { Meta, StoryObj } from '@storybook/angular';
import { SettingsMenu } from './settings-menu';

const meta: Meta<SettingsMenu> = {
  title: 'Pages/SettingsMenu',
  component: SettingsMenu,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    itemSelected: { action: 'itemSelected' },
  },
};
export default meta;

type Story = StoryObj<SettingsMenu>;

/** 設定トップ: 機能単位で編集対象を選ぶ */
export const Default: Story = {
  args: {
    items: [
      {
        id: 'tables',
        name: 'テーブル管理設定',
        description: '接続情報と管理対象テーブル',
        icon: 'table_view',
      },
      {
        id: 'functions',
        name: '機能設定',
        description: '機能の有効/無効',
        icon: 'apps',
      },
      {
        id: 'users',
        name: 'ユーザー権限',
        description: 'ユーザーごとの機能権限',
        icon: 'users',
      },
    ],
  },
};
