import type { Meta, StoryObj } from '@storybook/angular';
import { TemplateEditorDialog } from './template-editor-dialog';

const availableActions = [
  { id: 1, code: 'table-maint', name: 'テーブルメンテナンス', icon: 'table' },
  { id: 4, code: 'export', name: 'CSVエクスポート', icon: 'download' },
];

const meta: Meta<TemplateEditorDialog> = {
  title: 'Dialogs/TemplateEditor',
  component: TemplateEditorDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    saved: { action: 'saved' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<TemplateEditorDialog>;

/** 新規テンプレート作成 */
export const Create: Story = {
  args: { open: true, mode: 'create', availableActions },
};

/** 既存テンプレートの編集(機能 + リンクの混在) */
export const Edit: Story = {
  args: {
    open: true,
    mode: 'edit',
    availableActions,
    value: {
      name: '製造標準',
      description: 'テーブルメンテ + 生産ポータル',
      enabled: true,
      items: [
        { kind: 'action', actionId: 1, label: 'テーブルメンテナンス', icon: 'table' },
        { kind: 'link', label: '生産管理ポータル', url: 'https://portal.example.local/', icon: 'external-link' },
      ],
    },
  },
};

/** 保存エラー表示 */
export const WithError: Story = {
  args: {
    open: true,
    mode: 'create',
    availableActions,
    errorMessage: '同名のテンプレートが既に存在します',
  },
};
