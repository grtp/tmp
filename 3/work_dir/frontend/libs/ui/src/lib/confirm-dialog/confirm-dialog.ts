import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * 確認ダイアログ。削除やバッチ反映など、取り返しのつかない操作の前に挟む。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-confirm-dialog',
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="alertdialog" aria-modal="true">
          <div class="head">
            <i
              class="icon ti"
              [class.ti-alert-triangle]="danger()"
              [class.ti-help-circle]="!danger()"
              [class.danger]="danger()"
              aria-hidden="true"
            ></i>
            <span class="title">{{ title() }}</span>
          </div>
          <p class="message">{{ message() }}</p>
          <div class="foot">
            <button class="btn" type="button" [disabled]="busy()" (click)="cancelled.emit()">
              キャンセル
            </button>
            <button
              class="btn"
              type="button"
              [class.primary]="!danger()"
              [class.danger-btn]="danger()"
              [disabled]="busy()"
              (click)="confirmed.emit()"
            >
              {{ busy() ? '処理中…' : confirmLabel() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(31, 35, 41, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 110;
    }
    .dialog {
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: min(420px, calc(100vw - 32px));
      padding: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon {
      font-size: 20px;
      color: var(--tm-primary);
    }
    .icon.danger {
      color: var(--tm-danger);
    }
    .title {
      font-size: 14px;
      font-weight: 600;
    }
    .message {
      font-size: 13px;
      color: var(--tm-text-secondary);
      margin: 12px 0 16px;
      white-space: pre-line;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .btn {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      background: var(--tm-surface);
      color: var(--tm-text);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .btn.primary {
      background: var(--tm-primary);
      border-color: var(--tm-primary);
      color: var(--tm-text-on-primary);
    }
    .btn.danger-btn {
      background: var(--tm-danger);
      border-color: var(--tm-danger);
      color: var(--tm-text-on-primary);
    }
  `,
})
export class ConfirmDialog {
  readonly open = input(false);
  readonly title = input('確認');
  readonly message = input('');
  readonly confirmLabel = input('実行');
  readonly danger = input(false);
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
