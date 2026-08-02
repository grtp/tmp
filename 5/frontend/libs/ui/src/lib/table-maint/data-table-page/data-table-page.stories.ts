import type { Meta, StoryObj } from '@storybook/angular';
import { ColumnDef, DataTablePage, TableRow } from './data-table-page';

const itemColumns: ColumnDef[] = [
  { key: 'code', label: '品目コード', width: '110px', mono: true },
  { key: 'name', label: '品目名' },
  { key: 'category', label: '区分', width: '80px' },
  { key: 'updatedAt', label: '更新日', width: '100px' },
];

const itemRows: TableRow[] = [
  {
    code: 'A-10021',
    name: '原料アルミ板 t1.2',
    category: '原料',
    updatedAt: '2026-07-01',
  },
  {
    code: 'A-10022',
    name: '原料アルミ板 t2.0',
    category: '原料',
    updatedAt: '2026-06-28',
  },
  {
    code: 'B-20515',
    name: '中間品ユニットB',
    category: '中間品',
    updatedAt: '2026-06-15',
  },
  {
    code: 'B-20516',
    name: '中間品ユニットC',
    category: '中間品',
    updatedAt: '2026-06-12',
  },
  {
    code: 'C-30801',
    name: '完成品パネルA型',
    category: '完成品',
    updatedAt: '2026-06-10',
  },
];

const meta: Meta<DataTablePage> = {
  title: 'Pages/DataTable',
  component: DataTablePage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    predicatesChange: { action: 'predicatesChange' },
    tableChanged: { action: 'tableChanged' },
    createClicked: { action: 'createClicked' },
    rowSelected: { action: 'rowSelected' },
    bulkDeleteClicked: { action: 'bulkDeleteClicked' },
    pageChanged: { action: 'pageChanged' },
    pageSizeChanged: { action: 'pageSizeChanged' },
  },
  args: {
    tableNames: ['品目マスタ', '工程マスタ', 'ロットマスタ'],
    selectedTable: '品目マスタ',
    columns: itemColumns,
    rows: itemRows,
    totalCount: 128,
    page: 1,
    pageSize: 50,
    filterColumns: [
      { key: 'code', label: '品目コード', type: 'string' },
      { key: 'name', label: '品目名', type: 'string' },
      { key: 'updatedAt', label: '更新日', type: 'date' },
    ],
  },
};
export default meta;

type Story = StoryObj<DataTablePage>;

/** 標準表示 */
export const Default: Story = {};

/** データ読み込み中 */
export const Loading: Story = {
  args: { loading: true, rows: [] },
};

/** 検索結果 0件 */
export const Empty: Story = {
  args: { rows: [], totalCount: 0 },
};

/** 最終ページ表示 (ページャーの無効化確認) */
export const LastPage: Story = {
  args: { page: 3, totalCount: 128 },
};

/**
 * 別テーブル (メタデータ差し替えの確認)
 * columns / rows を入れ替えるだけで別マスタの表示に対応できることを示す
 */
export const ProcessMaster: Story = {
  args: {
    selectedTable: '工程マスタ',
    columns: [
      { key: 'processCode', label: '工程コード', width: '110px', mono: true },
      { key: 'processName', label: '工程名' },
      { key: 'line', label: 'ライン', width: '90px' },
      { key: 'owner', label: '担当', width: '90px' },
      { key: 'updatedAt', label: '更新日', width: '100px' },
    ],
    rows: [
      {
        processCode: 'P-001',
        processName: '切断',
        line: 'L1',
        owner: '製造1課',
        updatedAt: '2026-06-30',
      },
      {
        processCode: 'P-002',
        processName: 'プレス成形',
        line: 'L1',
        owner: '製造1課',
        updatedAt: '2026-06-22',
      },
      {
        processCode: 'P-010',
        processName: '表面処理',
        line: 'L2',
        owner: '製造2課',
        updatedAt: '2026-06-18',
      },
    ],
    totalCount: 42,
  },
};
