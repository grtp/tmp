import type { Meta, StoryObj } from '@storybook/angular';
import { HomePage } from './home-page';

const meta: Meta<HomePage> = {
  title: 'Pages/HomePage',
  component: HomePage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    linkOpened: { action: 'linkOpened' },
  },
};
export default meta;

type Story = StoryObj<HomePage>;

/** 8種ウィジェットすべてを含むフル構成 */
export const AllWidgets: Story = {
  args: {
    widgets: [
      {
        type: 'hero',
        size: 3,
        title: 'F-tool ポータル',
        subtitle: '運用業務の入り口。よく使う機能とリンクをここに集約しています。',
        links: [
          { label: 'テーブル管理', url: '/tables', icon: 'table_view' },
          { label: '社内ポータル', url: 'https://portal.example.com', icon: 'language' },
        ],
      },
      { type: 'heading', size: 3, text: '機能' },
      {
        type: 'cards',
        size: 3,
        items: [
          { label: 'テーブル管理', url: '/tables', icon: 'table_view', desc: '登録テーブルの参照・編集' },
          { label: '操作履歴', url: '/history', icon: 'history', desc: '監査ログの検索' },
          { label: '設定', url: '/settings', icon: 'settings', desc: '接続・権限の管理' },
        ],
      },
      {
        type: 'note',
        size: 2,
        tone: 'warn',
        text: '8/15(土) 21:00-23:00 はサーバーメンテナンスのため利用できません。',
      },
      {
        type: 'note',
        size: 1,
        tone: 'info',
        text: '問い合わせは情シス窓口まで。',
      },
      { type: 'divider', size: 3 },
      {
        type: 'rows',
        size: 2,
        title: '社内リンク',
        items: [
          { label: '勤怠システム', url: 'https://kintai.example.com', icon: 'schedule', desc: '打刻・休暇申請' },
          { label: '経費精算', url: 'https://keihi.example.com', icon: 'receipt_long' },
          { label: '製造部 Wiki', url: 'https://wiki.example.com/mfg', icon: 'menu_book', desc: '手順書・トラブル対応' },
        ],
      },
      {
        type: 'pills',
        size: 1,
        title: 'ショートカット',
        items: [
          { label: '在庫一覧', url: '/tables/1', icon: 'inventory_2' },
          { label: '得意先', url: '/tables/2' },
          { label: '外部カタログ', url: 'https://catalog.example.com' },
        ],
      },
      {
        type: 'text',
        size: 3,
        text: 'このページの内容は 設定 > ホーム設定 で変更できます。',
      },
    ],
  },
};

/** 未設定(組込フォールバック相当): 機能カードのみ */
export const FallbackCards: Story = {
  args: {
    widgets: [
      {
        type: 'cards',
        size: 3,
        items: [
          { label: 'テーブル管理', url: '/tables', icon: 'table_view' },
          { label: '操作履歴', url: '/history', icon: 'history' },
          { label: '設定', url: '/settings', icon: 'settings' },
        ],
      },
    ],
  },
};

/** ウィジェット0件(権限なし等) */
export const Empty: Story = {
  args: {
    widgets: [],
    emptyText: '利用できる機能がありません。管理者に権限の付与を依頼してください。',
  },
};
