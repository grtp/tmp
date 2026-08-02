import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { LinkDialog, LinkDialogData } from './link-dialog';

/* MatDialog 経由で開かれる前提のため,DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: LinkDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const meta: Meta<LinkDialog> = {
  title: 'Dialogs/Link',
  component: LinkDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    saved: { action: 'saved' },
  },
};
export default meta;

type Story = StoryObj<LinkDialog>;

/** ダッシュボードへの個人リンク追加 */
export const Create: Story = {
  decorators: [withDialog({ mode: 'create', value: null })],
};

/** 既存リンクの編集 */
export const Edit: Story = {
  decorators: [
    withDialog({
      mode: 'edit',
      value: { name: '社内Wiki', url: 'https://wiki.example.local/' },
    }),
  ],
};
