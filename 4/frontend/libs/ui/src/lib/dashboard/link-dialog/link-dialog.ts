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

/** 個人リンクカードの編集値。 */
export interface LinkDraft {
  name: string;
  url: string;
}

/** LinkDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface LinkDialogData {
  mode: 'create' | 'edit';
  /** 編集時の初期値 */
  value: LinkDraft | null;
}

/**
 * 個人リンクカードの追加/編集ダイアログ(ダッシュボードから使う)。
 * タイトルと URL だけの最小フォーム。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-link-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './link-dialog.html',
  styleUrl: './link-dialog.css',
})
export class LinkDialog {
  private readonly data = inject<LinkDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<LinkDialog>>(MatDialogRef);

  protected readonly mode = this.data.mode;

  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly saved = output<LinkDraft>();

  protected readonly name = signal(this.data.value?.name ?? '');
  protected readonly url = signal(this.data.value?.url ?? '');

  protected readonly canSave = computed(
    () => this.name().trim() !== '' && /^https?:\/\/.+/.test(this.url().trim()),
  );

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saved.emit({ name: this.name().trim(), url: this.url().trim() });
  }

  protected cancel(): void {
    if (!this.saving()) {
      this.dialogRef.close();
    }
  }

  /** disableClose で Esc は無効化されているため,busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
