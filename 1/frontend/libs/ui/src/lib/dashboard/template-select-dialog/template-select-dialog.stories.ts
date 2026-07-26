import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { TemplateSelectDialog, TemplateSelectDialogData } from './template-select-dialog';

/* MatDialog 経由で開かれる前提のため，DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: TemplateSelectDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const templates = [
  { id: 1, name: '製造標準', description: 'テーブルメンテ + 生産ポータル' },
  { id: 2, name: '品証向け', description: '検査系のみ' },
  { id: 3, name: '最小構成' },
];

const meta: Meta<TemplateSelectDialog> = {
  title: 'Dialogs/TemplateSelect',
  component: TemplateSelectDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    templateSelected: { action: 'templateSelected' },
  },
};
export default meta;

type Story = StoryObj<TemplateSelectDialog>;

/** 既定を使用中(テンプレート未選択) */
export const DefaultSelected: Story = {
  decorators: [withDialog({ templates, selectedId: null })],
};

/** テンプレートを選択中 */
export const TemplateSelected: Story = {
  decorators: [withDialog({ templates, selectedId: 2 })],
};

/** 配布テンプレートがまだ無い */
export const Empty: Story = {
  decorators: [withDialog({ templates: [], selectedId: null })],
};
