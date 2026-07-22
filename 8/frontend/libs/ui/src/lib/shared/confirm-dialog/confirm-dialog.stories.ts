import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { ConfirmData, ConfirmDialog } from './confirm-dialog';

/* MatDialog 経由で開かれる前提のため，DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: ConfirmData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const meta: Meta<ConfirmDialog> = {
  title: 'Dialogs/Confirm',
  component: ConfirmDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    confirmed: { action: 'confirmed' },
  },
};
export default meta;

type Story = StoryObj<ConfirmDialog>;

/** 行削除の確認(danger) */
export const DeleteRow: Story = {
  decorators: [
    withDialog({
      title: '行の削除',
      message: 'この行を削除します。よろしいですか？\n(この操作は履歴に記録されます)',
      confirmLabel: '削除',
      danger: true,
    }),
  ],
};

/** 管理テーブルの登録解除 */
export const UnregisterTable: Story = {
  decorators: [
    withDialog({
      title: '登録解除',
      message: '「商品マスタ」を管理対象から外します。実テーブルは削除されません。',
      confirmLabel: '解除',
      danger: true,
    }),
  ],
};

/** 処理中 */
export const Busy: Story = {
  decorators: [
    withDialog({
      title: '行の削除',
      message: 'この行を削除します。よろしいですか？',
      confirmLabel: '削除',
      danger: true,
    }),
  ],
  args: { busy: true },
};
