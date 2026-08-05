import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import {
  FilterColumn,
  FilterDraft,
  FilterPredicate,
  chipText,
  defaultDraft,
  draftFromPredicate,
  draftToPredicate,
  opAllowsMultiValues,
  opsFor,
} from './filter-model';

/** ポップオーバーの状態。editIndex = -1 は新規条件。 */
interface PopoverState {
  mode: 'column' | 'edit';
  /**
   * ビューポート座標(position: fixed)。バー内の絶対配置だと親パネルの
   * overflow: hidden でテーブルが小さいときに見切れるため,トリガー要素の
   * 真下へ fixed で重ねる(テーブルより手前に出る)。
   */
  left: number;
  top: number;
  columnKey?: string;
  editIndex: number;
}

const POPOVER_WIDTH = 260;

/**
 * チップエディタ型フィルタバー(グリッド非依存)。
 * [+フィルタ] → 列選択 → 型別の演算子+値 → チップ化。チップクリックで
 * 再編集,×で解除。出力は述語配列のみ(API 変換は filter-model.ts)。
 * tm-grid だけでなく将来の AG Grid 画面からも使う前提のため,
 * グリッドやデータ取得の知識を持たない。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-filter-bar',
  imports: [MatIcon, TranslocoPipe],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
})
export class FilterBar {
  private transloco = inject(TranslocoService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** フィルタ可能列(空なら [+フィルタ] を出さない) */
  readonly columns = input<FilterColumn[]>([]);
  /** 適用中の述語(親が状態を持つ。変更は predicatesChange で通知) */
  readonly predicates = input<FilterPredicate[]>([]);
  readonly predicatesChange = output<FilterPredicate[]>();
  /**
   * ポップオーバーの開閉通知。親(グリッド)が「条件0件でもポップオーバーが
   * 開いている間はバー行を出したままにする」ために使う。
   */
  readonly openChanged = output<boolean>();

  protected readonly pop = signal<PopoverState | null>(null);
  protected readonly colSearch = signal('');
  protected readonly draft = signal<FilterDraft>({
    op: 'contains',
    v1: '',
    v2: '',
    negate: false,
  });
  /** [適用]時の値検証エラー表示 */
  protected readonly invalid = signal(false);

  protected readonly filteredColumns = computed(() => {
    const f = this.colSearch().trim().toLowerCase();
    if (!f) return this.columns();
    return this.columns().filter((c) => c.label.toLowerCase().includes(f));
  });

  /** 編集中の列定義(pop.columnKey から解決) */
  protected readonly editColumn = computed<FilterColumn | null>(() => {
    const key = this.pop()?.columnKey;
    return this.columns().find((c) => c.key === key) ?? null;
  });

  protected readonly editOps = computed(() => {
    const col = this.editColumn();
    return col ? opsFor(col.type) : [];
  });

  protected readonly showMultiHint = computed(() => {
    const col = this.editColumn();
    return (
      !!col &&
      opAllowsMultiValues(this.draft().op) &&
      col.type !== 'bool' &&
      col.type !== 'enum'
    );
  });

  /** i18n キー変換: 'datetime' -> 'filterBar.typeDatetime', 'gte' -> 'filterBar.opGte' */
  protected typeKey(t: string): string {
    return 'filterBar.type' + t.charAt(0).toUpperCase() + t.slice(1);
  }

  protected opKey(op: string): string {
    return 'filterBar.op' + op.charAt(0).toUpperCase() + op.slice(1);
  }

  protected chipTextOf(p: FilterPredicate): string {
    const col = this.columns().find((c) => c.key === p.column);
    if (!col) return p.column;
    return chipText(col, p, this.transloco.translate('filterBar.negateSuffix'));
  }

  /** pop の遷移を一元化し,開閉の変化を openChanged で親へ通知する。 */
  private setPop(next: PopoverState | null): void {
    const wasOpen = this.pop() !== null;
    this.pop.set(next);
    const isOpen = next !== null;
    if (wasOpen !== isOpen) this.openChanged.emit(isOpen);
  }

  /**
   * アンカー要素の真下のビューポート座標。center=true でアンカー中央と
   * ポップオーバー中央を合わせる。横位置はテーブルパネル(なければ
   * ビューポート)からはみ出さない範囲にクランプする。
   */
  private anchorPos(
    el: HTMLElement | null,
    center = false,
  ): { left: number; top: number } {
    const r = el?.getBoundingClientRect();
    if (!r) return { left: 8, top: 8 };
    const panel = this.host.nativeElement.closest('.panel');
    const pr = panel?.getBoundingClientRect();
    const min = Math.max(8, (pr?.left ?? 0) + 4);
    const max = Math.max(
      min,
      (pr?.right ?? window.innerWidth) - POPOVER_WIDTH - 4,
    );
    const want = center ? r.left + r.width / 2 - POPOVER_WIDTH / 2 : r.left;
    return {
      left: Math.max(min, Math.min(want, max)),
      top: r.bottom + 4,
    };
  }

  /**
   * 列選択ポップオーバーを外部(ツールバーのじょうご等)から開く。
   * anchor(押されたボタン)の中央に合わせて真下に表示する。
   */
  openPicker(anchor?: HTMLElement): void {
    this.colSearch.set('');
    const el =
      anchor ?? this.host.nativeElement.querySelector<HTMLElement>('.add');
    this.setPop({ mode: 'column', ...this.anchorPos(el, true), editIndex: -1 });
  }

  protected openColumnPicker(e: Event): void {
    this.colSearch.set('');
    this.setPop({
      mode: 'column',
      ...this.anchorPos(e.currentTarget as HTMLElement),
      editIndex: -1,
    });
  }

  protected pickColumn(key: string): void {
    const cur = this.pop();
    const col = this.columns().find((c) => c.key === key);
    if (!cur || !col) return;
    this.draft.set(defaultDraft(col));
    this.invalid.set(false);
    this.setPop({ ...cur, mode: 'edit', columnKey: key });
  }

  protected openEdit(index: number, e: Event): void {
    const p = this.predicates()[index];
    if (!p) return;
    this.draft.set(draftFromPredicate(p));
    this.invalid.set(false);
    this.setPop({
      mode: 'edit',
      ...this.anchorPos(e.currentTarget as HTMLElement),
      columnKey: p.column,
      editIndex: index,
    });
  }

  protected setDraft(patch: Partial<FilterDraft>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
    this.invalid.set(false);
  }

  protected apply(): void {
    const cur = this.pop();
    const col = this.editColumn();
    if (!cur || !col) return;
    const pred = draftToPredicate(col, this.draft());
    if (!pred) {
      this.invalid.set(true);
      return;
    }
    const next = [...this.predicates()];
    if (cur.editIndex >= 0) {
      next[cur.editIndex] = pred;
    } else {
      next.push(pred);
    }
    this.setPop(null);
    this.predicatesChange.emit(next);
  }

  protected remove(index: number): void {
    this.setPop(null);
    this.predicatesChange.emit(this.predicates().filter((_, i) => i !== index));
  }

  protected clearAll(): void {
    this.setPop(null);
    this.predicatesChange.emit([]);
  }

  /** ポップオーバーを閉じる(親から他のポップオーバーを開く際にも使う)。 */
  close(): void {
    this.setPop(null);
  }

  /** コンポーネント外のクリックで閉じる(内側のクリックでは閉じない)。 */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(e: Event): void {
    if (!this.pop()) return;
    const target = e.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.setPop(null);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.setPop(null);
  }
}
