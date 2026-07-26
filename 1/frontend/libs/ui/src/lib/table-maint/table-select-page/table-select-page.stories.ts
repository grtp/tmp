import type { Meta, StoryObj } from '@storybook/angular';
import { TableSelectPage } from './table-select-page';

const meta: Meta<TableSelectPage> = {
  title: 'Pages/TableSelect',
  component: TableSelectPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    tableSelected: { action: 'tableSelected' },
  },
};
export default meta;

type Story = StoryObj<TableSelectPage>;

/** テーブルメンテナンスの入口: カードで対象テーブルを選ぶ */
export const Default: Story = {
  args: {
    tables: [
      {
        id: 1,
        displayName: '商品マスタ',
        schemaName: 'dbo',
        tableName: 'products',
        description: 'rowversion あり',
      },
      {
        id: 2,
        displayName: '取引先マスタ',
        schemaName: 'dbo',
        tableName: 'customers',
      },
      {
        id: 5,
        displayName: '資材マスタ',
        schemaName: 'dbo',
        tableName: 'materials',
        connectionName: '生産管理DB',
        description: '別接続のテーブル',
      },
    ],
  },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { loading: true },
};

/** 管理対象なし */
export const Empty: Story = {
  args: { tables: [] },
};
