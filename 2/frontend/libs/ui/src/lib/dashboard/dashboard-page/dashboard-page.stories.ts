import type { Meta, StoryObj } from '@storybook/angular';
import { DashboardPage, DashCard } from './dashboard-page';

const baseCards: DashCard[] = [
  {
    key: 'fn:item-master',
    kind: 'function',
    name: '品目マスタ',
    icon: 'database',
    permission: 'edit',
  },
  {
    key: 'fn:process-master',
    kind: 'function',
    name: '工程マスタ',
    icon: 'building-factory-2',
    permission: 'view',
  },
  {
    key: 'tpl:1',
    kind: 'link',
    name: '生産管理ポータル',
    icon: 'open_in_new',
    url: 'https://portal.example.local/',
  },
];

const meta: Meta<DashboardPage> = {
  title: 'Pages/Dashboard',
  component: DashboardPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    cardSelected: { action: 'cardSelected' },
    linkEditClicked: { action: 'linkEditClicked' },
    linkDeleteClicked: { action: 'linkDeleteClicked' },
    orderChanged: { action: 'orderChanged' },
    editExited: { action: 'editExited' },
    fabClicked: { action: 'fabClicked' },
  },
  args: {
    // ヘッダー/サイドバーは tm-app-shell 側(この画面はメインエリアのみ)
    greeting: 'おはようございます、山田太郎さん',
    cards: baseCards,
  },
};
export default meta;

type Story = StoryObj<DashboardPage>;

/** 標準: 機能カード(編集可/参照のみ) + テンプレ配布リンク */
export const Default: Story = {};

/** リンクカード付き(ホバーで編集ミニボタン。削除は編集モード中のみ) */
export const WithLinkCards: Story = {
  args: {
    cards: [
      ...baseCards,
      {
        key: 'item:1',
        kind: 'link',
        name: '社内Wiki',
        icon: 'open_in_new',
        url: 'https://wiki.example.local/',
      },
      {
        key: 'item:2',
        kind: 'link',
        name: '勤怠システム',
        icon: 'clock',
        url: 'https://kintai.example.local/',
      },
    ],
  },
};

/** 初回ログイン直後 (権限未付与でカードなし。FAB は表示) */
export const NoCards: Story = {
  args: {
    cards: [],
  },
};

/** 並び替えモード(D&D 有効。右下がキャンセル/決定に切り替わる) */
export const Reordering: Story = {
  args: {
    editMode: true,
  },
};

/** カード数が多い場合のグリッド折り返し + ドラッグ並べ替え確認 */
export const ManyCards: Story = {
  args: {
    cards: [
      ...baseCards,
      {
        key: 'fn:lot-master',
        kind: 'function',
        name: 'ロットマスタ',
        icon: 'stack-2',
        permission: 'edit',
      },
      {
        key: 'fn:inspection',
        kind: 'function',
        name: '受入検査項目',
        icon: 'checklist',
        permission: 'view',
      },
      {
        key: 'fn:export',
        kind: 'function',
        name: 'CSVエクスポート',
        icon: 'download',
        permission: 'edit',
      },
      {
        key: 'item:1',
        kind: 'link',
        name: '社内Wiki',
        icon: 'open_in_new',
        url: 'https://wiki.example.local/',
      },
    ],
  },
};
