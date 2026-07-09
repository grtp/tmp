import type { Meta, StoryObj } from '@storybook/angular';
import { ConnectionDialog } from './connection-dialog';

const meta: Meta<ConnectionDialog> = {
  title: 'Dialogs/Connection',
  component: ConnectionDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    saved: { action: 'saved' },
    testClicked: { action: 'testClicked' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<ConnectionDialog>;

/** 新規登録(パスワード必須) */
export const Create: Story = {
  args: { open: true, mode: 'create' },
};

/** 編集(パスワード空欄 = 変更なし) */
export const Edit: Story = {
  args: {
    open: true,
    mode: 'edit',
    value: {
      name: '生産管理DB',
      host: 'db2.example.local',
      port: 1433,
      databaseName: 'seisan',
      username: 'svc_forge',
      enabled: true,
    },
  },
};

/** 接続テスト成功の表示 */
export const TestOk: Story = {
  args: { ...Edit.args, testResult: 'OK (12ms)' },
};

/** 接続テスト失敗の表示 */
export const TestFailed: Story = {
  args: {
    ...Edit.args,
    testResult: '接続できません: mssql: login error: Login failed for user',
  },
};
