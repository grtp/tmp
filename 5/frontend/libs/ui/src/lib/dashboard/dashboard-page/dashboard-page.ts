import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';


export type Permission = 'edit' | 'view' | 'none';

export interface DashboardFunction {
  id: string;
  name: string;
  /** Material Symbols 名 */
  icon: string;
  permission: Permission;
}

/**
 * ダッシュボードのカード(統一モデル)。
 * key はカード順の永続化キー(item:<id>。全カードがサーバー項目の実体)。
 */
export interface DashCard {
  key: string;
  kind: 'function' | 'link' | 'table';
  /** 1行目 = 機能(テーブルカードは機能名,リンクはタイトル) */
  name: string;
  /** 2行目 = 詳細(テーブルカードはテーブル表示名,リンクは URL。無ければ空) */
  detail?: string;
  icon: string;
  /** function / table のみ */
  permission?: 'edit' | 'view';
  /** link のみ */
  url?: string;
  /** table のみ: 押下で /table-maint/{tableId} へ */
  tableId?: number;
  /** function のみ: 押下で /{code} へ(個人ショートカットの遷移解決用) */
  code?: string;
}

/**
 * ダッシュボード画面 (A案: クラシック業務系)
 *
 * - カードは統一モデル(機能/テンプレのリンク/個人リンク)を1列で描画
 * - HTML5 drag&drop でカードを並べ替え,ドロップ確定ごとに orderChanged を
 *   emit する(2026-07-23 決定: 削除と同様に即保存。[戻る]はモード終了のみ)
 * - 右下の FAB(機能追加)からリンク追加・テンプレート選択のモーダルを開く
 * - ヘッダー/サイドバーは共通の tm-app-shell(コンテナ側)が持つため,
 *   このコンポーネントはメインエリアの中身(挨拶文+カード+FAB)のみを描画する
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-page',
  imports: [MatButtonModule, MatCardModule, MatIcon, TranslocoPipe],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage {
  /** 挨拶文(名前込みの完成文をコンテナが渡す) */
  readonly greeting = input('');

  /** 表示するカード(順序込み。合成はコンテナの責務) */
  readonly cards = input<DashCard[]>([]);

  /** 並び替えモード(FAB→[並び替え]で入る。D&D はこの間だけ有効) */
  readonly editMode = input(false);

  /** カード0件時に表示する案内文の辞書キー(文言の出し分けはコンテナの責務) */
  readonly emptyKey = input('dashboard.empty');

  readonly cardSelected = output<DashCard>();
  /** リンクカード(kind='link')の鉛筆押下(名前/URL編集)。 */
  readonly linkEditClicked = output<DashCard>();
  /** カードの×押下(実削除。全カード種別が対象)。編集モード中のみ出る。 */
  readonly linkDeleteClicked = output<DashCard>();
  /** 並べ替えの確定(ドロップごとに発火。カードキー配列。保存はコンテナの責務) */
  readonly orderChanged = output<string[]>();
  /** 画面編集モードの終了([戻る]押下。変更は各操作で保存済み) */
  readonly editExited = output<void>();
  readonly fabClicked = output<void>();

  /** ドラッグ中のローカル順(null = 入力順のまま) */
  protected readonly localOrder = signal<string[] | null>(null);
  protected readonly dragKey = signal<string | null>(null);

  constructor() {
    // 入力カードが変わったらドラッグ中のローカル順は破棄する。
    effect(() => {
      void this.cards();
      this.localOrder.set(null);
    });
  }

  protected readonly displayCards = computed<DashCard[]>(() => {
    const cards = this.cards();
    const order = this.localOrder();
    if (!order) return cards;
    const byKey = new Map(cards.map((c) => [c.key, c]));
    const out: DashCard[] = [];
    for (const key of order) {
      const c = byKey.get(key);
      if (c) {
        out.push(c);
        byKey.delete(key);
      }
    }
    out.push(...byKey.values());
    return out;
  });

  protected permissionKey(p: 'edit' | 'view'): string {
    return p === 'edit'
      ? 'dashboard.permissionEdit'
      : 'dashboard.permissionView';
  }

  /** 並び替えモード中はカードクリックで遷移しない(誤操作防止)。 */
  protected onCardClick(card: DashCard): void {
    if (this.editMode()) return;
    this.cardSelected.emit(card);
  }

  protected onDragStart(e: DragEvent, key: string): void {
    if (!this.editMode()) {
      e.preventDefault();
      return;
    }
    this.dragKey.set(key);
    this.localOrder.update(
      (cur) => cur ?? this.displayCards().map((c) => c.key),
    );
    e.dataTransfer?.setData('text/plain', key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(e: DragEvent, overKey: string): void {
    const dragKey = this.dragKey();
    if (!dragKey) return;
    // プレビューで入替えた直後はカーソル下が「自分自身」になるため,
    // 自分の上でも常に preventDefault しないとブラウザが drop を拒否する(禁止カーソル)。
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragKey === overKey) return;

    // ドラッグ中のキーを overKey の位置へ移動(ライブプレビュー)。
    this.localOrder.update((order) => {
      const cur = order ?? this.displayCards().map((c) => c.key);
      const from = cur.indexOf(dragKey);
      const to = cur.indexOf(overKey);
      if (from < 0 || to < 0 || from === to) return cur;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, dragKey);
      return next;
    });
  }

  /** カードの隙間や余白でも drop を受け付ける(現在のプレビュー順で確定)。 */
  protected onContainerDragOver(e: DragEvent): void {
    if (!this.dragKey()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  protected onDrop(e: DragEvent): void {
    // カード上の drop はコンテナにもバブルするため,1回目で dragKey を落として弾く。
    if (!this.dragKey()) return;
    e.preventDefault();
    this.dragKey.set(null);
    // ドロップ確定ごとに即保存する(順序が実際に変わった場合のみ)。
    const order = this.localOrder();
    if (order && !order.every((k, i) => this.cards()[i]?.key === k)) {
      this.orderChanged.emit(order);
    }
  }

  protected onDragEnd(): void {
    // drop が来ないままドラッグが終わった(画面外で離した等)場合は
    // プレビューを破棄して元の順序へ戻す。
    if (this.dragKey()) {
      this.dragKey.set(null);
      this.localOrder.set(null);
    }
  }

  /** [戻る]押下: 画面編集モードを終了する(変更は各操作で保存済み)。 */
  protected onEditBack(): void {
    this.dragKey.set(null);
    this.editExited.emit();
  }
}
