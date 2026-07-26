import type { Meta, StoryObj } from '@storybook/angular';
import { HistoryPage, HistoryRow } from './history-page';

const entries: HistoryRow[] = [
  {
    id: 5,
    occurredAt: '2026-07-08T09:15:22Z',
    username: 'local',
    actionCode: 'table-maint',
    operation: 'rows.batch',
    target: 'dbo.products',
    detailText: JSON.stringify(
      { inserted: 1, updated: 2, deleted: 0, insertedKeys: [{ id: 6 }] },
      null,
      2,
    ),
    hasOverflow: false,
    result: 'success',
    clientIp: '192.168.1.10',
  },
  {
    id: 4,
    occurredAt: '2026-07-08T09:10:03Z',
    username: 'suzuki',
    actionCode: 'table-maint',
    operation: 'rows.batch',
    target: 'dbo.products',
    detailText: JSON.stringify(
      { updates: 1, error: 'row_version_mismatch' },
      null,
      2,
    ),
    hasOverflow: false,
    result: 'failure',
    errorCode: 'conflict',
    clientIp: '192.168.1.11',
  },
  {
    id: 3,
    occurredAt: '2026-07-08T09:00:00Z',
    username: 'admin',
    actionCode: 'settings',
    operation: 'managed-table.create',
    target: 'dbo.depts',
    detailText: JSON.stringify({ id: 3, displayName: '部門マスタ' }, null, 2),
    hasOverflow: false,
    result: 'success',
    clientIp: '192.168.1.5',
  },
  {
    id: 2,
    occurredAt: '2026-07-08T08:59:31Z',
    username: 'unknown',
    actionCode: 'auth',
    operation: 'login',
    detailText: '',
    hasOverflow: false,
    result: 'failure',
    errorCode: 'invalid_credentials',
    clientIp: '192.168.1.99',
  },
  {
    id: 6,
    occurredAt: '2026-07-08T09:20:00Z',
    username: 'local',
    actionCode: 'table-maint',
    operation: 'rows.batch',
    target: 'dbo.bigdata',
    detailText: JSON.stringify(
      {
        truncated: true,
        reason: 'detail exceeds 1MB',
        overflowKey: 'audit-overflow/xxxx.json',
      },
      null,
      2,
    ),
    hasOverflow: true,
    result: 'success',
    clientIp: '192.168.1.10',
  },
  {
    id: 1,
    occurredAt: '2026-07-08T08:55:00Z',
    username: 'local',
    actionCode: 'auth',
    operation: 'login',
    detailText: '',
    hasOverflow: false,
    result: 'success',
    clientIp: '192.168.1.10',
  },
];

const meta: Meta<HistoryPage> = {
  title: 'Pages/History',
  component: HistoryPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    filterChanged: { action: 'filterChanged' },
    pageChanged: { action: 'pageChanged' },
  },
};
export default meta;

type Story = StoryObj<HistoryPage>;

/** 操作履歴の一覧(行クリックで detail JSON 展開) */
export const Default: Story = {
  args: { entries, totalCount: 6 },
};

/** 読み込み中 */
export const Loading: Story = {
  args: { loading: true },
};

/** 履歴なし */
export const Empty: Story = {
  args: { entries: [], totalCount: 0 },
};
