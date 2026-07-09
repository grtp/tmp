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

/** 編集対象の初期値(パスワードは含まれない = API が返さない)。 */
export interface ConnectionDraft {
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  options?: string;
  enabled: boolean;
}

/** 保存/テスト時にダイアログが出す値。password は空文字 = 変更なし(編集時)。 */
export interface ConnectionSubmit extends ConnectionDraft {
  password: string;
}

/**
 * 接続の登録/編集ダイアログ(admin)。
 * - 新規: パスワード必須
 * - 編集: パスワード空欄 = 変更しない
 * - [接続テスト] は保存前に現在の入力値で疎通確認する
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-connection-dialog',
  imports: [TranslocoPipe],
  template: `
    @if (open()) {
      <div class="backdrop" (click)="cancelled.emit()">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="head">
            <span class="head-title">
              <i class="ti ti-plug" aria-hidden="true"></i>
              {{ (mode() === 'create' ? 'connectionDialog.createTitle' : 'connectionDialog.editTitle') | transloco }}
            </span>
            <button class="close" type="button" (click)="cancelled.emit()" [attr.aria-label]="'common.close' | transloco">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>

          <div class="body">
            @if (errorMessage(); as msg) {
              <p class="error">{{ msg }}</p>
            }
            @if (testResult(); as result) {
              <p class="test" [class.ng]="!result.startsWith('OK')">{{ result }}</p>
            }

            <label class="field">
              <span class="label">{{ 'connectionDialog.name' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
              <input class="input" type="text" maxlength="128" [value]="name()"
                (input)="name.set($any($event.target).value)" />
            </label>
            <div class="row">
              <label class="field grow">
                <span class="label">{{ 'connectionDialog.host' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
                <input class="input" type="text" maxlength="255" [value]="host()"
                  (input)="host.set($any($event.target).value)" />
              </label>
              <label class="field w100">
                <span class="label">{{ 'connectionDialog.port' | transloco }}</span>
                <input class="input" type="number" [value]="port()"
                  (input)="port.set(+$any($event.target).value)" />
              </label>
            </div>
            <label class="field">
              <span class="label">{{ 'connectionDialog.database' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
              <input class="input" type="text" maxlength="128" [value]="databaseName()"
                (input)="databaseName.set($any($event.target).value)" />
            </label>
            <div class="row">
              <label class="field grow">
                <span class="label">{{ 'connectionDialog.username' | transloco }} <span class="req">{{ 'common.required' | transloco }}</span></span>
                <input class="input" type="text" maxlength="128" autocomplete="off" [value]="username()"
                  (input)="username.set($any($event.target).value)" />
              </label>
              <label class="field grow">
                <span class="label">
                  {{ 'connectionDialog.password' | transloco }}
                  @if (mode() === 'create') {
                    <span class="req">{{ 'common.required' | transloco }}</span>
                  } @else {
                    <span class="hint">{{ 'connectionDialog.passwordKeep' | transloco }}</span>
                  }
                </span>
                <input class="input" type="password" autocomplete="new-password" [value]="password()"
                  (input)="password.set($any($event.target).value)" />
              </label>
            </div>
            <label class="field">
              <span class="label">{{ 'connectionDialog.options' | transloco }}</span>
              <input class="input mono" type="text" maxlength="256" [value]="options()"
                (input)="options.set($any($event.target).value)" />
            </label>
          </div>

          <div class="foot">
            <button class="btn" type="button" [disabled]="testing() || saving() || !canTest()" (click)="test()">
              {{ (testing() ? 'connectionDialog.testing' : 'connectionDialog.test') | transloco }}
            </button>
            <span class="spacer"></span>
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
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
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
      overflow-y: auto;
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
    .test {
      margin: 0;
      padding: 8px 10px;
      background: var(--tm-primary-tint-weak);
      color: var(--tm-primary);
      border-radius: var(--tm-radius);
      font-size: 12px;
    }
    .test.ng {
      background: var(--tm-danger-bg);
      color: var(--tm-danger);
    }
    .row {
      display: flex;
      gap: 10px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field.grow {
      flex: 1;
    }
    .field.w100 {
      width: 100px;
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
    .hint {
      font-size: 10px;
      color: var(--tm-text-muted);
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
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--tm-border);
    }
    .spacer {
      flex: 1;
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
export class ConnectionDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集時の初期値(open 時に取り込む) */
  readonly value = input<ConnectionDraft | null>(null);
  readonly saving = input(false);
  readonly testing = input(false);
  readonly errorMessage = input<string | null>(null);
  /** 接続テスト結果("OK (12ms)" / エラー文言)。コンテナが管理 */
  readonly testResult = input<string | null>(null);

  readonly saved = output<ConnectionSubmit>();
  readonly testClicked = output<ConnectionSubmit>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly host = signal('');
  protected readonly port = signal(1433);
  protected readonly databaseName = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly options = signal('');

  protected readonly canTest = computed(
    () =>
      this.host().trim() !== '' &&
      this.databaseName().trim() !== '' &&
      this.username().trim() !== '' &&
      (this.mode() === 'edit' || this.password() !== ''),
  );

  protected readonly canSave = computed(
    () =>
      this.name().trim() !== '' &&
      this.host().trim() !== '' &&
      this.databaseName().trim() !== '' &&
      this.username().trim() !== '' &&
      (this.mode() === 'edit' || this.password() !== ''),
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        const v = this.value();
        this.name.set(v?.name ?? '');
        this.host.set(v?.host ?? '');
        this.port.set(v?.port ?? 1433);
        this.databaseName.set(v?.databaseName ?? '');
        this.username.set(v?.username ?? '');
        this.password.set('');
        this.options.set(v?.options ?? '');
      }
    });
  }

  private submit(): ConnectionSubmit {
    return {
      name: this.name().trim(),
      host: this.host().trim(),
      port: this.port() || 1433,
      databaseName: this.databaseName().trim(),
      username: this.username().trim(),
      password: this.password(),
      options: this.options().trim() || undefined,
      enabled: this.value()?.enabled ?? true,
    };
  }

  protected test(): void {
    this.testClicked.emit(this.submit());
  }

  protected save(): void {
    this.saved.emit(this.submit());
  }
}
