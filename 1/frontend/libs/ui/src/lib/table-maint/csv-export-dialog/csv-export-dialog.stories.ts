import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { CsvExportDialog, CsvExportDialogData } from './csv-export-dialog';

/* MatDialog 経由で開かれる前提のため，DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: CsvExportDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const meta: Meta<CsvExportDialog> = {
  title: 'Dialogs/CsvExport',
  component: CsvExportDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    exported: { action: 'exported' },
  },
};
export default meta;

type Story = StoryObj<CsvExportDialog>;

/** 選択行あり(3スコープすべて有効) */
export const WithSelection: Story = {
  decorators: [withDialog({ selectionCount: 3, pageCount: 50 })],
};

/** 選択行なし(選択範囲出力が無効) */
export const NoSelection: Story = {
  decorators: [withDialog({ selectionCount: 0, pageCount: 50 })],
};
