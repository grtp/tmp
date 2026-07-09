import type { Meta, StoryObj } from '@storybook/angular';
import { LinkDialog } from './link-dialog';

const meta: Meta<LinkDialog> = {
  title: 'Dialogs/Link',
  component: LinkDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    saved: { action: 'saved' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<LinkDialog>;

/** ダッシュボードへの個人リンク追加 */
export const Create: Story = {
  args: { open: true, mode: 'create' },
};

/** 既存リンクの編集 */
export const Edit: Story = {
  args: {
    open: true,
    mode: 'edit',
    value: { name: '社内Wiki', url: 'https://wiki.example.local/' },
  },
};
