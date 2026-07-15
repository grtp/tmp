import type { Meta, StoryObj } from '@storybook/angular';
import { LoginPage } from './login-page';

const meta: Meta<LoginPage> = {
  title: 'Pages/Login',
  component: LoginPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    submitted: { action: 'submitted' },
  },
};
export default meta;

type Story = StoryObj<LoginPage>;

/** 初期表示 */
export const Default: Story = {};

/** 認証処理中: 入力・ボタンが無効化される */
export const Loading: Story = {
  args: { loading: true },
};

/** AD 認証失敗時 */
export const AuthError: Story = {
  args: {
    errorMessage: 'ユーザーIDまたはパスワードが正しくありません',
  },
};

/** システム名を差し替えた場合 (別環境向けビルドの確認用) */
export const CustomSystemName: Story = {
  args: { systemName: 'table-maint (検証環境)' },
};
