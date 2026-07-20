import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { LangSelect } from './lang-select';

const meta: Meta<LangSelect> = {
  title: 'Components/LangSelect',
  component: LangSelect,
};
export default meta;

type Story = StoryObj<LangSelect>;

/** 通常配色(白背景上) */
export const Default: Story = {};

/** ヘッダー(primary 背景)上の配色 */
export const OnPrimary: Story = {
  args: { variant: 'on-primary' },
  decorators: [
    componentWrapperDecorator(
      (story) => `<div style="background: var(--tm-primary); padding: 16px;">${story}</div>`,
    ),
  ],
};
