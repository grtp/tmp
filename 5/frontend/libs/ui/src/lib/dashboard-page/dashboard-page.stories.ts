import type { Meta, StoryObj } from '@storybook/angular';
import { DashboardPage, DashCard } from './dashboard-page';

const baseCards: DashCard[] = [
  { key: 'fn:item-master', kind: 'function', name: '品目マスタ', icon: 'database', permission: 'edit' },
  { key: 'fn:process-master', kind: 'function', name: '工程マスタ', icon: 'building-factory-2', permission: 'view' },
  { key: 'tpl:1', kind: 'link', name: '生産管理ポータル', icon: 'external-link', url: 'https://portal.example.local/' },
];

const meta: Meta<DashboardPage> = {
  title: 'Pages/Dashboard',
  component: DashboardPage,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    cardSelected: { action: 'cardSelected' },
    menuSelected: { action: 'menuSelected' },
    linkEditClicked: { action: 'linkEditClicked' },
    linkDeleteClicked: { action: 'linkDeleteClicked' },
    orderChanged: { action: 'orderChanged' },
    editCancelled: { action: 'editCancelled' },
    fabClicked: { action: 'fabClicked' },
  },
  args: {
    userName: '山田太郎',
    greeting: 'おはようございます、山田太郎さん',
    // ログアウトはヘッダーのユーザーメニュー(ドロワー)にある
    menuItems: [
      { id: 'home', label: 'ホーム', icon: 'home' },
      { id: 'history', label: '操作履歴', icon: 'history' },
      { id: 'settings', label: '設定', icon: 'settings' },
    ],
    cards: baseCards,
  },
};
export default meta;

type Story = StoryObj<DashboardPage>;

/** 標準: 機能カード(編集可/参照のみ) + テンプレ配布リンク */
export const Default: Story = {};

/** 個人リンクカード付き(ホバーで編集/削除ミニボタン) */
export const WithPersonalLinks: Story = {
  args: {
    cards: [
      ...baseCards,
      { key: 'mylink:1', kind: 'mylink', name: '社内Wiki', icon: 'external-link', url: 'https://wiki.example.local/' },
      { key: 'mylink:2', kind: 'mylink', name: '勤怠システム', icon: 'clock', url: 'https://kintai.example.local/' },
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
      { key: 'fn:lot-master', kind: 'function', name: 'ロットマスタ', icon: 'stack-2', permission: 'edit' },
      { key: 'fn:inspection', kind: 'function', name: '受入検査項目', icon: 'checklist', permission: 'view' },
      { key: 'fn:export', kind: 'function', name: 'CSVエクスポート', icon: 'download', permission: 'edit' },
      { key: 'mylink:1', kind: 'mylink', name: '社内Wiki', icon: 'external-link', url: 'https://wiki.example.local/' },
    ],
  },
};
