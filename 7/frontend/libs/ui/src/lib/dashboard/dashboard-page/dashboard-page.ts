import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type Permission = 'edit' | 'view' | 'none';

export interface DashboardFunction {
  id: string;
  name: string;
  /** Tabler icon 名 (例: 'database') */
  icon: string;
  permission: Permission;
}

/**
 * ダッシュボードのカード(統一モデル)。
 * key はカード順の永続化キー: fn:<code> / mylink:<id> / tpl:<itemId>
 * (テーブルカードも mylink/tpl のキー体系を共有する)
 */
export interface DashCard {
  key: string;
  kind: 'function' | 'link' | 'mylink' | 'table';
  /** 1行目 = 機能(テーブルカードは機能名，リンクはタイトル) */
  name: string;
  /** 2行目 = 詳細(テーブルカードはテーブル表示名，リンクは URL。無ければ空) */
  detail?: string;
  icon: string;
  /** function / table のみ */
  permission?: 'edit' | 'view';
  /** link/mylink のみ */
  url?: string;
  /** table のみ: 押下で /table-maint/{tableId} へ */
  tableId?: number;
  /** function のみ: 押下で /{code} へ(個人ショートカットの遷移解決用) */
  code?: string;
  /** 個人カード(削除ボタンで実削除)か。false の非個人カードは×で非表示化 */
  personal?: boolean;
}

/**
 * ダッシュボード画面 (A案: クラシック業務系)
 *
 * - カードは統一モデル(機能/テンプレのリンク/個人リンク)を1列で描画
 * - HTML5 drag&drop でカードを並べ替え，確定時に orderChanged を emit
 * - 右下の FAB(機能追加)からリンク追加・テンプレート選択のモーダルを開く
 * - ヘッダー/サイドバーは共通の tm-app-shell(コンテナ側)が持つため，
 *   このコンポーネントはメインエリアの中身(挨拶文+カード+FAB)のみを描画する
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-page',
  imports: [TranslocoPipe],
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

  readonly cardSelected = output<DashCard>();
  readonly linkEditClicked = output<DashCard>();
  readonly linkDeleteClicked = output<DashCard>();
  /** 非個人カード(テンプレ由来/既定機能)の×押下。非表示化はコンテナの責務 */
  readonly cardHideClicked = output<DashCard>();
  /** 並べ替え確定([決定]押下時のみ。カードキー配列) */
  readonly orderChanged = output<string[]>();
  /** 並び替えモードの終了(キャンセル or 変更なしの決定) */
  readonly editCancelled = output<void>();
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
    return p === 'edit' ? 'dashboard.permissionEdit' : 'dashboard.permissionView';
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
    this.localOrder.update((cur) => cur ?? this.displayCards().map((c) => c.key));
    e.dataTransfer?.setData('text/plain', key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(e: DragEvent, overKey: string): void {
    const dragKey = this.dragKey();
    if (!dragKey) return;
    // プレビューで入替えた直後はカーソル下が「自分自身」になるため，
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
    // カード上の drop はコンテナにもバブルするため，1回目で dragKey を落として弾く。
    if (!this.dragKey()) return;
    e.preventDefault();
    // 保存はしない([決定]で確定)。プレビュー順(localOrder)を保持したまま終了。
    this.dragKey.set(null);
  }

  protected onDragEnd(): void {
    // モード中はドラッグを離した位置の順序を保持する(確定/破棄はボタンで行う)。
    this.dragKey.set(null);
  }

  protected onEditCancel(): void {
    this.dragKey.set(null);
    this.localOrder.set(null); // プレビューを破棄して元の順序へ
    this.editCancelled.emit();
  }

  protected onEditConfirm(): void {
    this.dragKey.set(null);
    const order = this.localOrder();
    if (order) {
      this.orderChanged.emit(order);
    } else {
      // 一度もドラッグしていない = 変更なし。保存せず終了。
      this.editCancelled.emit();
    }
  }
}
