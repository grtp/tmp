import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { PickableTable } from '../table-pick-dialog/table-pick-dialog';
import { SelectableTemplate } from '../template-select-dialog/template-select-dialog';

/** ショートカットを追加できる機能(権限のあるものをコンテナが渡す)。 */
export interface ShortcutFunction {
  /** app_actions.id(ショートカットカードの保存に使う) */
  id: number;
  code: string;
  name: string;
  icon: string;
  /** true ならサブ階層に「テーブルを指定」を出す(table-maint) */
  hasTables?: boolean;
}

/** ダイアログ内のビュー。root からの階層遷移で ← 戻りができる。 */
type ViewId =
  | 'root'
  | 'shortcut'
  | 'link'
  | 'function'
  | 'tables'
  | 'templateMenu'
  | 'template'
  | 'saveTemplate';

/**
 * ダッシュボードの[機能の選択](FAB)モーダル。
 * 単一ダイアログ内のビュー切替(← で前画面へ)で階層をたどる:
 *
 *   root ── 機能リンク ─ 機能 ─ 「〈機能〉画面」(即 emit)
 *        │           │      └ テーブルを指定 ─ テーブル1..n(即 emit)
 *        │           └ URLリンクを追加(最下部。フォーム → emit)
 *        └─ テンプレート ─ テンプレートを選択 ─ 既定/配布/個人(即 emit。個人は×で削除可)
 *                       ├ 現在の構成を保存(名前フォーム → emit)
 *                       └ 並び替え(即 emit)
 *
 * バックドロップを閉じずにビューだけ差し替えるため、別ダイアログの
 * 開き直しで起きていた画面のちらつきが発生しない。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-add-feature-dialog',
  imports: [TranslocoPipe],
  templateUrl: './add-feature-dialog.html',
  styleUrl: './add-feature-dialog.css',
})
export class AddFeatureDialog {
  readonly open = input(false);
  /** ショートカット追加対象の機能(空ならエントリ自体を出さない) */
  readonly functions = input<ShortcutFunction[]>([]);
  /** 「テーブルを指定」で選べる管理対象テーブル */
  readonly tables = input<PickableTable[]>([]);
  /** 「テンプレートを選択」の選択肢 */
  readonly templates = input<SelectableTemplate[]>([]);
  /** 現在選択中のテンプレート(null = 既定) */
  readonly selectedTemplateId = input<number | null>(null);
  /** リンク追加の保存中(ボタン無効化) */
  readonly saving = input(false);
  /** リンク追加の失敗メッセージ(ダイアログは開いたまま表示する) */
  readonly errorMessage = input<string | null>(null);

  /** 即時アクション: 'reorder' */
  readonly entrySelected = output<string>();
  /** リンク追加フォームの確定(作成はコンテナの責務) */
  readonly linkSubmitted = output<{ name: string; url: string }>();
  /** 「現在の構成を保存」の確定(個人テンプレート作成はコンテナの責務) */
  readonly templateSaveRequested = output<string>();
  /** 個人テンプレートの×押下(削除はコンテナの責務) */
  readonly personalTemplateDeleted = output<number>();
  /** 「〈機能〉画面」の追加(機能へのショートカットカード) */
  readonly shortcutPicked = output<ShortcutFunction>();
  readonly tablePicked = output<PickableTable>();
  /** null = 既定を選択 */
  readonly templateSelected = output<number | null>();
  readonly cancelled = output<void>();

  /** ビューの遷移スタック(先頭 root は含まない)。 */
  protected readonly stack = signal<ViewId[]>([]);
  /** 「機能」ビューで選択中の機能。 */
  protected readonly currentFn = signal<ShortcutFunction | null>(null);
  /** リンク追加フォームの入力。 */
  protected readonly linkName = signal('');
  protected readonly linkUrl = signal('');
  /** 「現在の構成を保存」のテンプレート名。 */
  protected readonly tplName = signal('');

  protected readonly view = computed<ViewId>(() => {
    const s = this.stack();
    return s.length > 0 ? s[s.length - 1] : 'root';
  });

  protected readonly canSubmitLink = computed(
    () => this.linkName().trim() !== '' && /^https?:\/\/.+/.test(this.linkUrl().trim()),
  );

  protected readonly canSaveTemplate = computed(() => this.tplName().trim() !== '');

  constructor() {
    effect(() => {
      if (this.open()) {
        this.stack.set([]);
        this.currentFn.set(null);
        this.linkName.set('');
        this.linkUrl.set('');
        this.tplName.set('');
      }
    });
  }

  protected submitTemplateSave(): void {
    if (!this.canSaveTemplate() || this.saving()) return;
    this.templateSaveRequested.emit(this.tplName().trim());
  }

  protected submitLink(): void {
    if (!this.canSubmitLink() || this.saving()) return;
    this.linkSubmitted.emit({ name: this.linkName().trim(), url: this.linkUrl().trim() });
  }

  protected push(view: ViewId): void {
    this.stack.update((s) => [...s, view]);
  }

  protected back(): void {
    this.stack.update((s) => s.slice(0, -1));
  }

  protected enterFunction(fn: ShortcutFunction): void {
    this.currentFn.set(fn);
    this.push('function');
  }

  protected titleKey(): string {
    switch (this.view()) {
      case 'shortcut':
        return 'addFeature.shortcut';
      case 'link':
        return 'addFeature.link';
      case 'tables':
        return 'addFeature.pickTable';
      case 'templateMenu':
        return 'addFeature.templateMenu';
      case 'template':
        return 'templateSelect.title';
      case 'saveTemplate':
        return 'addFeature.saveTemplate';
      default:
        return 'addFeature.title';
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.open()) return;
    // Esc も「1つ戻る」に割り当てる(root で押せば閉じる)。
    if (this.stack().length > 0) {
      this.back();
    } else {
      this.cancelled.emit();
    }
  }
}
