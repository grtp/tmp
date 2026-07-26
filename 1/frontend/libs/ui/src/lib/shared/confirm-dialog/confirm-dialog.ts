import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';

/** ConfirmData は開く側(コンテナ)が渡す表示内容。翻訳済み文字列を渡す。 */
export interface ConfirmData {
  title: string;
  message: string;
  /** 空なら「実行」相当の既定ラベル */
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * 確認ダイアログ。削除やバッチ反映など，取り返しのつかない操作の前に挟む。
 * 規約: 自分では API を呼ばず confirmed を emit するだけ。開閉と実行は
 * コンテナ(core/dialog.ts の confirmThen)が握る。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<ConfirmDialog>>(MatDialogRef);

  /** 処理中(コンテナが componentRef.setInput で更新する) */
  readonly busy = input(false);

  readonly confirmed = output<void>();

  /** disableClose で Esc は無効化されているため，busy 中以外は自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }

  protected cancel(): void {
    if (!this.busy()) {
      this.dialogRef.close();
    }
  }
}
