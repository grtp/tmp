import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * 確認ダイアログ。削除やバッチ反映など、取り返しのつかない操作の前に挟む。
 * title/message はコンテナが翻訳済みの文字列を渡す。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-confirm-dialog',
  imports: [TranslocoPipe],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
  readonly open = input(false);
  /** 翻訳済みの文字列を渡す(コンテナの責務) */
  readonly title = input('');
  readonly message = input('');
  /** 空文字なら「実行」相当の既定ラベル */
  readonly confirmLabel = input('');
  readonly danger = input(false);
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.busy()) {
      this.cancelled.emit();
    }
  }
}
