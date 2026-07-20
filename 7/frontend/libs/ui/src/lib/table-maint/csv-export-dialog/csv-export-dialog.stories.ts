import type { Meta, StoryObj } from '@storybook/angular';
import { CsvExportDialog } from './csv-export-dialog';

const meta: Meta<CsvExportDialog> = {
  title: 'Dialogs/CsvExport',
  component: CsvExportDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    exported: { action: 'exported' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<CsvExportDialog>;

/** 選択行あり(3スコープすべて有効) */
export const WithSelection: Story = {
  args: { open: true, selectionCount: 3, pageCount: 50 },
};

/** 選択行なし(選択範囲出力が無効) */
export const NoSelection: Story = {
  args: { open: true, selectionCount: 0, pageCount: 50 },
};
