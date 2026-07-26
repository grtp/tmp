import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { EditColumn, RowEditDialog, RowEditDialogData } from './row-edit-dialog';

/* MatDialog 経由で開かれる前提のため，DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: RowEditDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const productColumns: EditColumn[] = [
  { name: 'id', type: 'int', nullable: false, readonly: true },
  {
    name: 'code',
    type: 'string',
    nullable: false,
    readonly: false,
    required: true,
    maxLength: 20,
  },
  {
    name: 'name',
    type: 'string',
    nullable: false,
    readonly: false,
    required: true,
    maxLength: 100,
  },
  {
    name: 'category',
    type: 'string',
    nullable: true,
    readonly: false,
    maxLength: 50,
  },
  {
    name: 'price',
    type: 'decimal',
    nullable: false,
    readonly: false,
    required: true,
  },
  {
    name: 'stock',
    type: 'int',
    nullable: false,
    readonly: false,
    required: true,
  },
  { name: 'updated_at', type: 'datetime', nullable: false, readonly: false },
];

const meta: Meta<RowEditDialog> = {
  title: 'Dialogs/RowEdit',
  component: RowEditDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    saved: { action: 'saved' },
    deleteClicked: { action: 'deleteClicked' },
  },
};
export default meta;

type Story = StoryObj<RowEditDialog>;

const createData: RowEditDialogData = {
  mode: 'create',
  columns: productColumns,
  value: {},
  canDelete: false,
};

const editData: RowEditDialogData = {
  mode: 'edit',
  columns: productColumns,
  canDelete: true,
  value: {
    id: 42,
    code: 'A-1001',
    name: 'ボールペン 黒',
    category: '文具',
    price: 120,
    stock: 500,
    updated_at: '2026-07-01T09:30:00Z',
  },
};

/** 新規行の追加。readonly 列(IDENTITY)は無効化される */
export const Create: Story = {
  decorators: [withDialog(createData)],
};

/** 既存行の編集(削除ボタンあり = maintainer/admin) */
export const Edit: Story = {
  decorators: [withDialog(editData)],
};

/** サーバー側バリデーション/競合エラーの表示 */
export const ConflictError: Story = {
  decorators: [withDialog(editData)],
  args: {
    errorMessage:
      '他のユーザーが先に変更しています。再読込してやり直してください',
  },
};

/** 保存中 */
export const Saving: Story = {
  decorators: [withDialog(editData)],
  args: { saving: true },
};
