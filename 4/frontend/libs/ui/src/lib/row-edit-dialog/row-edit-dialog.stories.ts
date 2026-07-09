import type { Meta, StoryObj } from '@storybook/angular';
import { EditColumn, RowEditDialog } from './row-edit-dialog';

const productColumns: EditColumn[] = [
  { name: 'id', type: 'int', nullable: false, readonly: true },
  { name: 'code', type: 'string', nullable: false, readonly: false, required: true, maxLength: 20 },
  { name: 'name', type: 'string', nullable: false, readonly: false, required: true, maxLength: 100 },
  { name: 'category', type: 'string', nullable: true, readonly: false, maxLength: 50 },
  { name: 'price', type: 'decimal', nullable: false, readonly: false, required: true },
  { name: 'stock', type: 'int', nullable: false, readonly: false, required: true },
  { name: 'updated_at', type: 'datetime', nullable: false, readonly: false },
];

const meta: Meta<RowEditDialog> = {
  title: 'Dialogs/RowEdit',
  component: RowEditDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    saved: { action: 'saved' },
    deleteClicked: { action: 'deleteClicked' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<RowEditDialog>;

/** 新規行の追加。readonly 列(IDENTITY)は無効化される */
export const Create: Story = {
  args: {
    open: true,
    mode: 'create',
    columns: productColumns,
    value: {},
  },
};

/** 既存行の編集(削除ボタンあり = maintainer/admin) */
export const Edit: Story = {
  args: {
    open: true,
    mode: 'edit',
    canDelete: true,
    columns: productColumns,
    value: {
      id: 42,
      code: 'A-1001',
      name: 'ボールペン 黒',
      category: '文具',
      price: 120,
      stock: 500,
      updated_at: '2026-07-01T09:30:00Z',
    },
  },
};

/** サーバー側バリデーション/競合エラーの表示 */
export const ConflictError: Story = {
  args: {
    ...Edit.args,
    errorMessage: '他のユーザーが先に変更しています。再読込してやり直してください',
  },
};

/** 保存中 */
export const Saving: Story = {
  args: { ...Edit.args, saving: true },
};
