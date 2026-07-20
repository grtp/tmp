import type { Meta, StoryObj } from '@storybook/angular';
import { ManagedTableDialog } from './managed-table-dialog';

const meta: Meta<ManagedTableDialog> = {
  title: 'Dialogs/ManagedTable',
  component: ManagedTableDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    candidateSelected: { action: 'candidateSelected' },
    confirmed: { action: 'confirmed' },
    cancelled: { action: 'cancelled' },
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

/** 候補一覧の表示。PK の無いテーブルは選択不可 */
export const Default: Story = {
  args: {
    open: true,
    candidates,
  },
};

/** テーブル選択後: カラムプレビュー表示 */
export const WithPreview: Story = {
  args: {
    open: true,
    candidates,
    preview: {
      primaryKey: ['id'],
      hasRowVersion: true,
      columns: [
        { name: 'id', type: 'int', nullable: false, readonly: true },
        { name: 'order_no', type: 'string', nullable: false, readonly: false },
        { name: 'ordered_at', type: 'datetime', nullable: false, readonly: false },
        { name: 'total', type: 'decimal', nullable: true, readonly: false },
      ],
    },
  },
};

/** 登録失敗(重複など) */
export const RegisterError: Story = {
  args: {
    ...WithPreview.args,
    errorMessage: 'dbo.orders は既に登録されています',
  },
};
