import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { ManagedTableDialog, ManagedTableDialogData } from './managed-table-dialog';

/* MatDialog 経由で開かれる前提のため,DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: ManagedTableDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const meta: Meta<ManagedTableDialog> = {
  title: 'Dialogs/ManagedTable',
  component: ManagedTableDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    candidateSelected: { action: 'candidateSelected' },
    confirmed: { action: 'confirmed' },
  },
};
export default meta;

type Story = StoryObj<ManagedTableDialog>;

const candidates = [
  { schemaName: 'dbo', tableName: 'orders', hasPrimaryKey: true },
  { schemaName: 'dbo', tableName: 'order_lines', hasPrimaryKey: true },
  { schemaName: 'dbo', tableName: 'work_log', hasPrimaryKey: false },
  { schemaName: 'mst', tableName: 'units', hasPrimaryKey: true },
];

const createData: ManagedTableDialogData = {
  mode: 'create',
  editValue: null,
  connections: [],
  usedSlugs: ['orders'],
};

/** 候補一覧の表示。PK の無いテーブルは選択不可 */
export const Default: Story = {
  decorators: [withDialog(createData)],
  args: { candidates },
};

/** テーブル選択後: カラムプレビュー表示 */
export const WithPreview: Story = {
  decorators: [withDialog(createData)],
  args: {
    candidates,
    preview: {
      primaryKey: ['id'],
      hasRowVersion: true,
      columns: [
        { name: 'id', type: 'int', nullable: false, readonly: true },
        { name: 'order_no', type: 'string', nullable: false, readonly: false },
        {
          name: 'ordered_at',
          type: 'datetime',
          nullable: false,
          readonly: false,
        },
        { name: 'total', type: 'decimal', nullable: true, readonly: false },
      ],
    },
  },
};

/** 登録失敗(重複など) */
export const RegisterError: Story = {
  decorators: [withDialog(createData)],
  args: {
    ...WithPreview.args,
    errorMessage: 'dbo.orders は既に登録されています',
  },
};
