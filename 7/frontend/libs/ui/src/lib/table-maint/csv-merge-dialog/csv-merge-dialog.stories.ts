import type { Meta, StoryObj } from '@storybook/angular';
import { CsvMergeDialog, CsvMergeRow } from './csv-merge-dialog';

const columns = [
  { key: 'code', label: 'code' },
  { key: 'name', label: 'name' },
  { key: 'val', label: 'val' },
];

const rows: CsvMergeRow[] = [
  { display: { code: 'C-001', name: 'コード1', val: '10' }, conflict: true },
  { display: { code: 'C-101', name: '新規コードA', val: '40' }, conflict: false },
  { display: { code: 'C-102', name: '新規コードB', val: 'abc' }, conflict: false, typeError: 'val: 整数で指定してください' },
  { display: { code: 'C-002', name: 'コード2(重複)', val: '20' }, conflict: true },
  { display: { code: 'C-103', name: '新規コードC', val: '60' }, conflict: false },
];

const meta: Meta<CsvMergeDialog> = {
  title: 'Dialogs/CsvMerge',
  component: CsvMergeDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    applied: { action: 'applied' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<CsvMergeDialog>;

/** 重複(赤)と型エラー(オレンジ)の混在。行クリック+ドラッグで範囲選択 */
export const Mixed: Story = {
  args: { open: true, columns, rows },
};

/** 主キー自動採番テーブルへの取込(注記表示) */
export const IdentityNote: Story = {
  args: { open: true, columns, rows, identityNote: true },
};

/** 重複・エラーなし */
export const Clean: Story = {
  args: {
    open: true,
    columns,
    rows: rows.filter((r) => !r.conflict && !r.typeError),
  },
};
