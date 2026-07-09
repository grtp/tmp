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

/** 個人リンクカードの編集値。 */
export interface LinkDraft {
  name: string;
  url: string;
}

/**
 * 個人リンクカードの追加/編集ダイアログ(ダッシュボードから使う)。
 * タイトルと URL だけの最小フォーム。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-link-dialog',
  imports: [TranslocoPipe],
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="head">
            <span class="head-title">
              <i class="ti ti-external-link" aria-hidden="true"></i>
              {{ (mode() === 'create' ? 'linkDialog.createTitle' : 'linkDialog.editTitle') | transloco }}
            </span>
            <button class="close" type="button" (click)="cancelled.emit()" [attr.aria-label]="'common.close' | transloco">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>

          <div class="body">
            @if (errorMessage(); as msg) {
              <p class="error">{{ msg }}</p>
            }
            <label class="field">
              <span class="label">{{ 'linkDialog.name' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
              <input class="input" type="text" maxlength="128" [value]="name()"
                (input)="name.set($any($event.target).value)" (keydown.enter)="save()" />
            </label>
            <label class="field">
              <span class="label">{{ 'linkDialog.url' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
              <input class="input mono" type="url" maxlength="512" placeholder="https://..."
                [value]="url()" (input)="url.set($any($event.target).value)" (keydown.enter)="save()" />
            </label>
          </div>

          <div class="foot">
            <button class="btn" type="button" [disabled]="saving()" (click)="cancelled.emit()">
              {{ 'common.cancel' | transloco }}
            </button>
            <button class="btn primary" type="button" [disabled]="saving() || !canSave()" (click)="save()">
              {{ (saving() ? 'common.saving' : 'common.save') | transloco }}
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
      z-index: 100;
    }
    .dialog {
      background: var(--tm-surface);
      border-radius: var(--tm-radius);
      width: min(420px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tm-border);
    }
    .head-title {
      font-size: 14px;
      font-weight: 600;
    }
    .close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--tm-text-secondary);
      font-size: 16px;
    }
    .body {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .error {
      margin: 0;
      padding: 8px 10px;
      background: var(--tm-danger-bg);
      color: var(--tm-danger);
      border-radius: var(--tm-radius);
      font-size: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .label {
      font-size: 12px;
      color: var(--tm-text-secondary);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .req {
      color: var(--tm-danger);
      font-size: 10px;
      border: 1px solid currentColor;
      border-radius: 3px;
      padding: 0 4px;
    }
    .input {
      height: 32px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      padding: 0 8px;
      color: var(--tm-text);
    }
    .input.mono {
      font-family: var(--tm-font-mono);
    }
    .input:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--tm-border);
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
  `,
})
export class LinkDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集時の初期値(open 時に取り込む) */
  readonly value = input<LinkDraft | null>(null);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly saved = output<LinkDraft>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly url = signal('');

  protected readonly canSave = computed(
    () => this.name().trim() !== '' && /^https?:\/\/.+/.test(this.url().trim()),
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.name.set(this.value()?.name ?? '');
        this.url.set(this.value()?.url ?? '');
      }
    });
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saved.emit({ name: this.name().trim(), url: this.url().trim() });
  }
}
