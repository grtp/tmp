import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
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
  /** 表示用(kind=action は機能名，kind=link はタイトル，kind=table はテーブル表示名) */
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

/** TemplateEditorDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface TemplateEditorDialogData {
  mode: 'create' | 'edit';
  /** 編集時の初期値 */
  value: TemplateDraft | null;
  /** テンプレートに追加できる機能(除外済みリストをコンテナが渡す) */
  availableActions: EditorAction[];
  /** テンプレートに追加できる管理対象テーブル(enabled のみ) */
  availableTables: EditorTable[];
}

/**
 * ダッシュボードテンプレートの作成/編集ダイアログ(admin)。
 * 名前/説明/有効 + カード構成(機能参照 or リンク)を ↑↓ で並べて保存する。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-template-editor-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './template-editor-dialog.html',
  styleUrl: './template-editor-dialog.css',
})
export class TemplateEditorDialog {
  private readonly data = inject<TemplateEditorDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TemplateEditorDialog>>(MatDialogRef);

  protected readonly mode = this.data.mode;
  protected readonly availableActions = this.data.availableActions;
  protected readonly availableTables = this.data.availableTables;

  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly saved = output<TemplateDraft>();

  protected readonly name = signal(this.data.value?.name ?? '');
  protected readonly description = signal(this.data.value?.description ?? '');
  protected readonly enabled = signal(this.data.value?.enabled ?? true);
  protected readonly items = signal<EditorItem[]>(
    this.data.value ? [...this.data.value.items] : [],
  );
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
    return this.availableActions.filter((a) => !used.has(a.id));
  });

  /** まだ追加していないテーブルだけ選択肢に出す(重複カード防止)。 */
  protected readonly selectableTables = computed(() => {
    const used = new Set(
      this.items()
        .filter((i) => i.kind === 'table')
        .map((i) => i.managedTableId),
    );
    return this.availableTables.filter((t) => !used.has(t.id));
  });

  protected readonly canSave = computed(() => this.name().trim() !== '');

  protected canAddLink(): boolean {
    return (
      this.pendingLinkName().trim() !== '' &&
      /^https?:\/\/.+/.test(this.pendingLinkUrl().trim())
    );
  }

  protected addAction(): void {
    const id = Number(this.pendingActionId());
    const a = this.availableActions.find((x) => x.id === id);
    if (!a) return;
    this.items.update((xs) => [
      ...xs,
      { kind: 'action', actionId: a.id, label: a.name, icon: a.icon },
    ]);
    this.pendingActionId.set('');
  }

  protected addTable(): void {
    const id = Number(this.pendingTableId());
    const t = this.availableTables.find((x) => x.id === id);
    if (!t) return;
    this.items.update((xs) => [
      ...xs,
      {
        kind: 'table',
        managedTableId: t.id,
        label: t.displayName,
        icon: 'table_view',
      },
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
        icon: 'open_in_new',
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

  protected cancel(): void {
    if (!this.saving()) {
      this.dialogRef.close();
    }
  }

  /** disableClose で Esc は無効化されているため，busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
