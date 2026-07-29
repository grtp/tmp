import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { TemplateEditorDialog, TemplateEditorDialogData } from './template-editor-dialog';

/* MatDialog 経由で開かれる前提のため，DI(データと ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = (data: TemplateEditorDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
    ],
  });

const availableActions = [
  { id: 1, code: 'table-maint', name: 'テーブルメンテナンス', icon: 'table_view' },
  { id: 4, code: 'export', name: 'CSVエクスポート', icon: 'download' },
];

const meta: Meta<TemplateEditorDialog> = {
  title: 'Dialogs/TemplateEditor',
  component: TemplateEditorDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    saved: { action: 'saved' },
  },
};
export default meta;

type Story = StoryObj<TemplateEditorDialog>;

/** 新規テンプレート作成 */
export const Create: Story = {
  decorators: [
    withDialog({ mode: 'create', value: null, availableActions, availableTables: [] }),
  ],
};

/** 既存テンプレートの編集(機能 + リンクの混在) */
export const Edit: Story = {
  decorators: [
    withDialog({
      mode: 'edit',
      availableActions,
      availableTables: [],
      value: {
        name: '製造標準',
        description: 'テーブルメンテ + 生産ポータル',
        enabled: true,
        items: [
          {
            kind: 'action',
            actionId: 1,
            label: 'テーブルメンテナンス',
            icon: 'table_view',
          },
          {
            kind: 'link',
            label: '生産管理ポータル',
            url: 'https://portal.example.local/',
            icon: 'open_in_new',
          },
        ],
      },
    }),
  ],
};

/** 保存エラー表示 */
export const WithError: Story = {
  decorators: [
    withDialog({ mode: 'create', value: null, availableActions, availableTables: [] }),
  ],
  args: {
    errorMessage: '同名のテンプレートが既に存在します',
  },
};
