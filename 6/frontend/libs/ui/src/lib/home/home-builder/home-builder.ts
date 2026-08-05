import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import { HomePage } from '../home-page/home-page';
import {
  HomeLinkItem,
  HomeWidget,
  HomeWidgetConfig,
  HomeWidgetSize,
  HomeWidgetView,
} from '../home-widget/home-widget';

/** requires(表示条件)の選択肢。コンテナが機能マスタから作って渡す。 */
export interface RequiresOption {
  code: string;
  label: string;
}

/** パレットの1項目(ウィジェット種別)。 */
interface PaletteEntry {
  type: HomeWidgetConfig['type'];
  icon: string;
}

const PALETTE: PaletteEntry[] = [
  { type: 'hero', icon: 'wallpaper' },
  { type: 'heading', icon: 'title' },
  { type: 'text', icon: 'notes' },
  { type: 'note', icon: 'info' },
  { type: 'divider', icon: 'horizontal_rule' },
  { type: 'rows', icon: 'view_list' },
  { type: 'pills', icon: 'label' },
  { type: 'cards', icon: 'grid_view' },
];

/**
 * ホーム設定のビルダー。左=パレット(クリックで追加),中央=キャンバス
 * (実レンダラ tm-home-widget のプレビュー。D&D か ↑↓ で並べ替え),
 * 右=インスペクタ(選択ウィジェットの編集)。
 * 状態の持ち主はコンテナ: 変更のたびに widgetsChanged で全量を返す。
 * 保存(=即公開)/既定に戻す/JSON 適用の実行もコンテナが握る。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-home-builder',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    HomePage,
    HomeWidgetView,
    MatIcon,
    TranslocoPipe,
  ],
  templateUrl: './home-builder.html',
  styleUrl: './home-builder.css',
})
export class HomeBuilder {
  private transloco = inject(TranslocoService);

  readonly widgets = input<HomeWidgetConfig[]>([]);
  /** 実際の表示(プレビュー)用: 権限フィルタ適用済みのウィジェット。 */
  readonly previewWidgets = input<HomeWidget[]>([]);
  readonly requiresOptions = input<RequiresOption[]>([]);
  readonly saving = input(false);
  readonly dirty = input(false);
  /** API エラー(保存失敗等)。 */
  readonly errorMessage = input<string | null>(null);
  /** JSON 適用エラー(コンテナのパーサが弾いた時)。 */
  readonly jsonError = input<string | null>(null);

  readonly widgetsChanged = output<HomeWidgetConfig[]>();
  readonly saveClicked = output<void>();
  readonly resetClicked = output<void>();
  readonly jsonApplied = output<string>();

  protected readonly palette = PALETTE;
  protected readonly selected = signal<number | null>(null);
  protected readonly jsonOpen = signal(false);
  protected readonly jsonDraft = signal('');
  /** プレビュー表示中か(編集ペインの代わりに実レンダラを全面表示)。 */
  protected readonly previewOpen = signal(false);

  protected readonly selectedWidget = computed<HomeWidgetConfig | null>(() => {
    const i = this.selected();
    return i === null ? null : (this.widgets()[i] ?? null);
  });

  // ---- パレット(追加)

  protected add(type: HomeWidgetConfig['type']): void {
    const t = (key: string) => this.transloco.translate('homeBuilder.default.' + key);
    const item = (): HomeLinkItem => ({ label: t('itemLabel'), url: '/home' });
    let w: HomeWidgetConfig;
    switch (type) {
      case 'hero':
        w = { type, size: 3, title: t('heroTitle'), links: [] };
        break;
      case 'heading':
        w = { type, size: 3, text: t('heading') };
        break;
      case 'text':
        w = { type, size: 3, text: t('text') };
        break;
      case 'note':
        w = { type, size: 3, tone: 'info', text: t('note') };
        break;
      case 'divider':
        w = { type, size: 3 };
        break;
      case 'rows':
      case 'pills':
      case 'cards':
        w = { type, size: 3, items: [item()] };
        break;
    }
    const next = [...this.widgets(), w];
    this.selected.set(next.length - 1);
    this.widgetsChanged.emit(next);
  }

  // ---- キャンバス(選択・並べ替え・削除)

  protected select(i: number): void {
    this.selected.set(i);
  }

  protected onDrop(e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    const next = [...this.widgets()];
    moveItemInArray(next, e.previousIndex, e.currentIndex);
    this.selected.set(e.currentIndex);
    this.widgetsChanged.emit(next);
  }

  protected move(i: number, delta: -1 | 1): void {
    const j = i + delta;
    const next = [...this.widgets()];
    if (j < 0 || j >= next.length) return;
    moveItemInArray(next, i, j);
    this.selected.set(j);
    this.widgetsChanged.emit(next);
  }

  protected remove(i: number): void {
    const next = this.widgets().filter((_, k) => k !== i);
    this.selected.set(null);
    this.widgetsChanged.emit(next);
  }

  // ---- インスペクタ(選択中ウィジェットの編集)

  /** 選択中ウィジェットを部分更新して全量 emit する。 */
  protected patch(partial: Partial<HomeWidgetConfig>): void {
    const i = this.selected();
    if (i === null) return;
    const next = [...this.widgets()];
    next[i] = { ...next[i], ...partial } as HomeWidgetConfig;
    this.widgetsChanged.emit(next);
  }

  protected setSize(size: HomeWidgetSize): void {
    this.patch({ size });
  }

  protected setRequires(code: string): void {
    const i = this.selected();
    if (i === null) return;
    const next = [...this.widgets()];
    const w = { ...next[i] } as HomeWidgetConfig;
    if (code === '') {
      delete w.requires;
    } else {
      w.requires = code;
    }
    next[i] = w;
    this.widgetsChanged.emit(next);
  }

  protected inputValue(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  /** hero の links / rows・pills・cards の items(同じ編集 UI を使う)。 */
  protected selectedItems(): HomeLinkItem[] {
    const w = this.selectedWidget();
    if (w === null) return [];
    if (w.type === 'hero') return w.links;
    if (w.type === 'rows' || w.type === 'pills' || w.type === 'cards') return w.items;
    return [];
  }

  protected hasItems(): boolean {
    const w = this.selectedWidget();
    return w !== null &&
      (w.type === 'hero' || w.type === 'rows' || w.type === 'pills' || w.type === 'cards');
  }

  private patchItems(items: HomeLinkItem[]): void {
    const w = this.selectedWidget();
    if (w === null) return;
    if (w.type === 'hero') {
      this.patch({ links: items });
    } else if (w.type === 'rows' || w.type === 'pills' || w.type === 'cards') {
      this.patch({ items });
    }
  }

  protected addItem(): void {
    const label = this.transloco.translate('homeBuilder.default.itemLabel');
    this.patchItems([...this.selectedItems(), { label, url: '/home' }]);
  }

  protected patchItem(k: number, partial: Partial<HomeLinkItem>): void {
    const items = [...this.selectedItems()];
    const merged = { ...items[k], ...partial };
    // 空文字の任意フィールドは保存 JSON から消す(icon="" を残さない)
    if (merged.icon === '') delete merged.icon;
    if (merged.desc === '') delete merged.desc;
    if (merged.requires === '') delete merged.requires;
    items[k] = merged;
    this.patchItems(items);
  }

  protected moveItem(k: number, delta: -1 | 1): void {
    const j = k + delta;
    const items = [...this.selectedItems()];
    if (j < 0 || j >= items.length) return;
    moveItemInArray(items, k, j);
    this.patchItems(items);
  }

  protected removeItem(k: number): void {
    this.patchItems(this.selectedItems().filter((_, x) => x !== k));
  }

  // ---- JSON パネル(直接編集。2環境間の持ち運び用)

  protected toggleJson(): void {
    if (!this.jsonOpen()) this.refreshJson();
    this.jsonOpen.set(!this.jsonOpen());
  }

  /** 現在の構成をテキストエリアへ反映(エクスポート)。 */
  protected refreshJson(): void {
    this.jsonDraft.set(
      JSON.stringify({ version: 1, widgets: this.widgets() }, null, 2),
    );
  }

  protected applyJson(): void {
    this.selected.set(null);
    this.jsonApplied.emit(this.jsonDraft());
  }
}
