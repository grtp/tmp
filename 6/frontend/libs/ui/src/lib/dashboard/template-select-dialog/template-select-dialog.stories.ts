import type { Meta, StoryObj } from '@storybook/angular';
import { TemplateSelectDialog } from './template-select-dialog';

const templates = [
  { id: 1, name: '製造標準', description: 'テーブルメンテ + 生産ポータル' },
  { id: 2, name: '品証向け', description: '検査系のみ' },
  { id: 3, name: '最小構成' },
];

const meta: Meta<TemplateSelectDialog> = {
  title: 'Dialogs/TemplateSelect',
  component: TemplateSelectDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    templateSelected: { action: 'templateSelected' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<TemplateSelectDialog>;

/** 既定を使用中(テンプレート未選択) */
export const DefaultSelected: Story = {
  args: { open: true, templates, selectedId: null },
};

/** テンプレートを選択中 */
export const TemplateSelected: Story = {
  args: { open: true, templates, selectedId: 2 },
};

/** 配布テンプレートがまだ無い */
export const Empty: Story = {
  args: { open: true, templates: [], selectedId: null },
};
