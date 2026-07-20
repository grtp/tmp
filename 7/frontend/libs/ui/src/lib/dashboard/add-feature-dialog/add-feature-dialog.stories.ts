import type { Meta, StoryObj } from '@storybook/angular';
import { AddFeatureDialog } from './add-feature-dialog';

const meta: Meta<AddFeatureDialog> = {
  title: 'Dialogs/AddFeature',
  component: AddFeatureDialog,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    entrySelected: { action: 'entrySelected' },
    shortcutPicked: { action: 'shortcutPicked' },
    tablePicked: { action: 'tablePicked' },
    templateSelected: { action: 'templateSelected' },
    cancelled: { action: 'cancelled' },
  },
};
export default meta;

type Story = StoryObj<AddFeatureDialog>;

/**
 * FAB から開く機能選択メニュー。単一ダイアログ内の階層ビュー:
 * リンク追加 / 機能へのショートカット追加(→機能→テーブル指定) /
 * テンプレート選択 / 並び替え。← で前画面へ戻れる。
 */
export const Default: Story = {
  args: {
    open: true,
    functions: [
      { id: 1, code: 'table-maint', name: 'テーブルメンテナンス', icon: 'table', hasTables: true },
    ],
    tables: [
      { id: 1, displayName: '商品マスタ', schemaName: 'dbo', tableName: 'products' },
      { id: 4, displayName: 'コードマスタ', schemaName: 'dbo', tableName: 'codes', connectionName: 'demoDB' },
    ],
    templates: [
      { id: 1, name: '製造部門標準', description: '製造ラインの定番構成' },
    ],
    selectedTemplateId: null,
  },
};
