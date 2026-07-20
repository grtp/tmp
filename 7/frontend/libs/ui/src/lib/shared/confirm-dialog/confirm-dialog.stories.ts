import type { Meta, StoryObj } from '@storybook/angular';
import { ConfirmDialog } from './confirm-dialog';

const meta: Meta<ConfirmDialog> = {
  title: 'Dialogs/Confirm',
  component: ConfirmDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    confirmed: { action: 'confirmed' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<ConfirmDialog>;

/** 行削除の確認(danger) */
export const DeleteRow: Story = {
  args: {
    open: true,
    title: '行の削除',
    message: 'この行を削除します。よろしいですか？\n(この操作は履歴に記録されます)',
    confirmLabel: '削除',
    danger: true,
  },
};

/** 管理テーブルの登録解除 */
export const UnregisterTable: Story = {
  args: {
    open: true,
    title: '登録解除',
    message: '「商品マスタ」を管理対象から外します。実テーブルは削除されません。',
    confirmLabel: '解除',
    danger: true,
  },
};

/** 処理中 */
export const Busy: Story = {
  args: { ...DeleteRow.args, busy: true },
};
