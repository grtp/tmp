import type { Meta, StoryObj } from '@storybook/angular';
import { PageHeader } from './page-header';

const meta: Meta<PageHeader> = {
  title: 'Parts/PageHeader',
  component: PageHeader,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    backClicked: { action: 'backClicked' },
    logoutClicked: { action: 'logoutClicked' },
  },
};
export default meta;

type Story = StoryObj<PageHeader>;

/** サブ画面の標準ヘッダー */
export const Default: Story = {
  args: {
    pageTitle: 'テーブルメンテナンス',
    userName: '山田太郎',
  },
};

/** 設定画面 */
export const Settings: Story = {
  args: {
    pageTitle: '設定',
    userName: '管理者 花子',
  },
};
