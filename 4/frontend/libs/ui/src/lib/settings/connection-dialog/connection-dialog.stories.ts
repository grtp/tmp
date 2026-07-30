import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { ConnectionDialog, ConnectionDialogData, ConnectionDraft } from './connection-dialog';

/* MatDialog 経由で開かれる前提のため,DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const editValue: ConnectionDraft = {
  name: '生産管理DB',
  host: 'db2.example.local',
  port: 1433,
  databaseName: 'seisan',
  username: 'svc_ftool',
  enabled: true,
};

const withDialog = (data: ConnectionDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const meta: Meta<ConnectionDialog> = {
  title: 'Dialogs/Connection',
  component: ConnectionDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    saved: { action: 'saved' },
    testClicked: { action: 'testClicked' },
  },
};
export default meta;

type Story = StoryObj<ConnectionDialog>;

/** 新規登録(パスワード必須) */
export const Create: Story = {
  decorators: [withDialog({ mode: 'create', value: null })],
};

/** 編集(パスワード空欄 = 変更なし) */
export const Edit: Story = {
  decorators: [withDialog({ mode: 'edit', value: editValue })],
};

/** 接続テスト成功の表示 */
export const TestOk: Story = {
  decorators: [withDialog({ mode: 'edit', value: editValue })],
  args: { testResult: 'OK (12ms)' },
};

/** 接続テスト失敗の表示 */
export const TestFailed: Story = {
  decorators: [withDialog({ mode: 'edit', value: editValue })],
  args: { testResult: '接続できません: mssql: login error: Login failed for user' },
};
