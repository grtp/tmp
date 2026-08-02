import type { Meta, StoryObj } from '@storybook/angular';
import { FilterBar } from './filter-bar';

const meta: Meta<FilterBar> = {
  title: 'Components/FilterBar',
  component: FilterBar,
};
export default meta;

type Story = StoryObj<FilterBar>;

const columns = [
  { key: 'code', label: 'code', type: 'string' as const },
  { key: 'val', label: 'val', type: 'int' as const },
  { key: 'active', label: 'active', type: 'bool' as const },
  { key: 'updated_at', label: 'updated_at', type: 'datetime' as const },
  {
    key: 'result',
    label: '成否',
    type: 'enum' as const,
    enumValues: [
      { value: 'success', label: '成功' },
      { value: 'failure', label: '失敗' },
    ],
  },
];

/** 条件なし([+フィルタ]のみ) */
export const Empty: Story = {
  args: { columns },
};

/** 適用中の条件チップ(否定チップ含む) */
export const WithPredicates: Story = {
  args: {
    columns,
    predicates: [
      { column: 'code', op: 'contains', values: ['B-001', 'C-2'] },
      { column: 'val', op: 'range', values: ['10', '20'] },
      { column: 'result', op: 'eq', values: ['failure'], negate: true },
    ],
  },
};
