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
    manageClicked: { action: 'manageClicked' },
  },
};
export default meta;

type Story = StoryObj<TableSelectPage>;

/** テーブル管理の入口: カードで対象テーブルを選ぶ(検索・カード/リスト切替つき) */
export const Default: Story = {
  args: {
    tables: [
      {
        id: 1,
        displayName: '商品マスタ',
        schemaName: 'dbo',
        tableName: 'products',
        description: 'rowversion あり',
        createdAt: '2026-06-01T00:00:00Z',
        lastActivityAt: '2026-08-04T09:02:00Z',
      },
      {
        id: 2,
        displayName: '取引先マスタ',
        schemaName: 'dbo',
        tableName: 'customers',
        createdAt: '2026-06-01T00:00:00Z',
      },
      {
        id: 5,
        displayName: '資材マスタ',
        schemaName: 'dbo',
        tableName: 'materials',
        connectionName: '生産管理DB',
        description: '別接続のテーブル',
        createdAt: '2026-07-15T03:20:00Z',
        lastActivityAt: '2026-07-30T00:41:00Z',
      },
    ],
  },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { loading: true },
};

/** 管理対象なし(settings:admin なら登録導線を出す) */
export const Empty: Story = {
  args: { tables: [], canManage: true },
};
