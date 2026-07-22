import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { UserMenu } from './user-menu';

const meta: Meta<UserMenu> = {
  title: 'Parts/UserMenu',
  component: UserMenu,
  argTypes: {
    topClicked: { action: 'topClicked' },
    logoutClicked: { action: 'logoutClicked' },
  },
  // ヘッダー(primary 背景)上に置かれる前提のコンポーネント
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div style="background: var(--tm-primary); padding: 10px 16px; display: flex; justify-content: flex-end; min-height: 220px; align-items: flex-start;">${story}</div>`,
    ),
  ],
};
export default meta;

type Story = StoryObj<UserMenu>;

/** ユーザー名押下でドロワー(トップへ戻る / ログアウト)が開く */
export const Default: Story = {
  args: { userName: '山田太郎' },
};
