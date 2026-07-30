import { MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { AddFeatureDialog } from './add-feature-dialog';

/* MatDialog 経由で開かれる前提のため,DI(ref)をモックして
   中身だけをカタログ表示する。 */
const withDialog = () =>
  applicationConfig({
    providers: [{ provide: MatDialogRef, useValue: { close: () => undefined } }],
  });

const meta: Meta<AddFeatureDialog> = {
  title: 'Dialogs/AddFeature',
  component: AddFeatureDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    entrySelected: { action: 'entrySelected' },
    shortcutPicked: { action: 'shortcutPicked' },
    tablePicked: { action: 'tablePicked' },
    templateSelected: { action: 'templateSelected' },
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
  decorators: [withDialog()],
  args: {
    functions: [
      {
        id: 1,
        code: 'table-maint',
        name: 'テーブルメンテナンス',
        icon: 'table_view',
        hasTables: true,
      },
    ],
    tables: [
      {
        id: 1,
        displayName: '商品マスタ',
        schemaName: 'dbo',
        tableName: 'products',
      },
      {
        id: 4,
        displayName: 'コードマスタ',
        schemaName: 'dbo',
        tableName: 'codes',
        connectionName: 'demoDB',
      },
    ],
    templates: [
      { id: 1, name: '製造部門標準', description: '製造ラインの定番構成' },
    ],
    selectedTemplateId: null,
  },
};
