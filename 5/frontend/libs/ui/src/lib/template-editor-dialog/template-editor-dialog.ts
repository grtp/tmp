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

/** テンプレートに追加できる機能(コンテナが権限系を除外して渡す)。 */
export interface EditorAction {
  id: number;
  code: string;
  name: string;
  icon: string;
}

/** テンプレートに追加できる管理対象テーブル。 */
export interface EditorTable {
  id: number;
  displayName: string;
}

/** エディタ内の1項目。 */
export interface EditorItem {
  kind: 'action' | 'link' | 'table';
  actionId?: number;
  /** kind=table のみ */
  managedTableId?: number;
  /** 表示用(kind=action は機能名、kind=link はタイトル、kind=table はテーブル表示名) */
  label: string;
  icon: string;
  url?: string;
}

export interface TemplateDraft {
  name: string;
  description: string;
  enabled: boolean;
  items: EditorItem[];
}

/**
 * ダッシュボードテンプレートの作成/編集ダイアログ(admin)。
 * 名前/説明/有効 + カード構成(機能参照 or リンク)を ↑↓ で並べて保存する。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-template-editor-dialog',
  imports: [TranslocoPipe],
  templateUrl: './template-editor-dialog.html',
  styleUrl: './template-editor-dialog.css',
})
export class TemplateEditorDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集時の初期値(open 時に取り込む) */
  readonly value = input<TemplateDraft | null>(null);
  /** テンプレートに追加できる機能(除外済みリストをコンテナが渡す) */
  readonly availableActions = input<EditorAction[]>([]);
  /** テンプレートに追加できる管理対象テーブル(enabled のみ) */
  readonly availableTables = input<EditorTable[]>([]);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly saved = output<TemplateDraft>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly enabled = signal(true);
  protected readonly items = signal<EditorItem[]>([]);
  protected readonly pendingActionId = signal('');
  protected readonly pendingTableId = signal('');
  protected readonly pendingLinkName = signal('');
  protected readonly pendingLinkUrl = signal('');

  /** まだ追加していない機能だけ選択肢に出す(重複カード防止)。 */
  protected readonly selectableActions = computed(() => {
    const used = new Set(
      this.items()
        .filter((i) => i.kind === 'action')
        .map((i) => i.actionId),
    );
    return this.availableActions().filter((a) => !used.has(a.id));
  });

  /** まだ追加していないテーブルだけ選択肢に出す(重複カード防止)。 */
  protected readonly selectableTables = computed(() => {
    const used = new Set(
      this.items()
        .filter((i) => i.kind === 'table')
        .map((i) => i.managedTableId),
    );
    return this.availableTables().filter((t) => !used.has(t.id));
  });

  protected readonly canSave = computed(() => this.name().trim() !== '');

  constructor() {
    effect(() => {
      if (this.open()) {
        const v = this.value();
        this.name.set(v?.name ?? '');
        this.description.set(v?.description ?? '');
        this.enabled.set(v?.enabled ?? true);
        this.items.set(v ? [...v.items] : []);
        this.pendingActionId.set('');
        this.pendingTableId.set('');
        this.pendingLinkName.set('');
        this.pendingLinkUrl.set('');
      }
    });
  }

  protected canAddLink(): boolean {
    return (
      this.pendingLinkName().trim() !== '' &&
      /^https?:\/\/.+/.test(this.pendingLinkUrl().trim())
    );
  }

  protected addAction(): void {
    const id = Number(this.pendingActionId());
    const a = this.availableActions().find((x) => x.id === id);
    if (!a) return;
    this.items.update((xs) => [
      ...xs,
      { kind: 'action', actionId: a.id, label: a.name, icon: a.icon },
    ]);
    this.pendingActionId.set('');
  }

  protected addTable(): void {
    const id = Number(this.pendingTableId());
    const t = this.availableTables().find((x) => x.id === id);
    if (!t) return;
    this.items.update((xs) => [
      ...xs,
      { kind: 'table', managedTableId: t.id, label: t.displayName, icon: 'table' },
    ]);
    this.pendingTableId.set('');
  }

  protected addLink(): void {
    if (!this.canAddLink()) return;
    this.items.update((xs) => [
      ...xs,
      {
        kind: 'link',
        label: this.pendingLinkName().trim(),
        url: this.pendingLinkUrl().trim(),
        icon: 'external-link',
      },
    ]);
    this.pendingLinkName.set('');
    this.pendingLinkUrl.set('');
  }

  protected move(index: number, delta: number): void {
    this.items.update((xs) => {
      const next = [...xs];
      const to = index + delta;
      if (to < 0 || to >= next.length) return xs;
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  protected remove(index: number): void {
    this.items.update((xs) => xs.filter((_, i) => i !== index));
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saved.emit({
      name: this.name().trim(),
      description: this.description().trim(),
      enabled: this.enabled(),
      items: this.items(),
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.saving()) {
      this.cancelled.emit();
    }
  }
}
