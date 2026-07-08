import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

export interface LoginSubmit {
  userId: string;
  password: string;
}

/**
 * ログイン画面 (A案: クラシック業務系)
 *
 * - ブランドカラーのトップボーダー付きカードを中央配置
 * - AD 認証を想定し、エラー表示とローディング状態を input で制御
 * - Angular 22: OnPush がデフォルトのため changeDetection 指定は不要
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-login-page',
  template: `
    <div class="page">
      <div class="card">
        <h1 class="title">{{ systemName() }}</h1>
        <p class="subtitle">社内アカウントでログイン</p>

        @if (errorMessage(); as msg) {
          <p class="error" role="alert">
            <i class="ti ti-alert-circle" aria-hidden="true"></i> {{ msg }}
          </p>
        }

        <label class="label" for="tm-login-user">ユーザーID</label>
        <input
          id="tm-login-user"
          class="input"
          type="text"
          autocomplete="username"
          placeholder="t.yamada"
          [value]="userId()"
          [disabled]="loading()"
          (input)="userId.set($any($event.target).value)"
        />

        <label class="label" for="tm-login-pass">パスワード</label>
        <input
          id="tm-login-pass"
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          [value]="password()"
          [disabled]="loading()"
          (input)="password.set($any($event.target).value)"
          (keydown.enter)="onSubmit()"
        />

        <button
          class="submit"
          type="button"
          [disabled]="loading() || !canSubmit()"
          (click)="onSubmit()"
        >
          @if (loading()) {
            認証中…
          } @else {
            ログイン
          }
        </button>

        <p class="note">
          <i class="ti ti-lock" aria-hidden="true"></i> Active Directory 認証
        </p>
      </div>
    </div>
  `,
  styles: `
    .page {
      min-height: 100vh;
      background: var(--tm-page-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-border);
      border-top: 3px solid var(--tm-primary);
      border-radius: var(--tm-radius);
      padding: 28px 32px 24px;
      width: 320px;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 4px;
      text-align: center;
    }
    .subtitle {
      font-size: 12px;
      color: var(--tm-text-muted);
      margin: 0 0 20px;
      text-align: center;
    }
    .error {
      font-size: 12px;
      color: var(--tm-danger);
      background: var(--tm-danger-bg);
      border-radius: var(--tm-radius);
      padding: 8px 10px;
      margin: 0 0 14px;
    }
    .label {
      display: block;
      font-size: 12px;
      color: var(--tm-text-secondary);
      margin-bottom: 4px;
    }
    .input {
      width: 100%;
      box-sizing: border-box;
      height: 36px;
      padding: 0 10px;
      font-size: 14px;
      font-family: inherit;
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius);
      margin-bottom: 12px;
      background: var(--tm-surface);
      color: var(--tm-text);
    }
    .input:focus {
      outline: none;
      border-color: var(--tm-primary);
      box-shadow: 0 0 0 2px var(--tm-primary-tint);
    }
    .input:disabled {
      background: var(--tm-surface-alt);
      color: var(--tm-text-muted);
    }
    .submit {
      width: 100%;
      height: 38px;
      margin-top: 8px;
      background: var(--tm-primary);
      color: var(--tm-text-on-primary);
      border: none;
      border-radius: var(--tm-radius);
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
    }
    .submit:hover:not(:disabled) {
      background: var(--tm-primary-dark);
    }
    .submit:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .note {
      font-size: 11px;
      color: var(--tm-text-muted);
      text-align: center;
      margin: 14px 0 0;
    }
  `,
})
export class LoginPage {
  /** ヘッダに表示するシステム名 */
  readonly systemName = input('テーブル管理システム');
  /** 認証処理中フラグ (入力とボタンを無効化) */
  readonly loading = input(false);
  /** 認証エラーメッセージ (null なら非表示) */
  readonly errorMessage = input<string | null>(null);

  /** ログインボタン押下 / Enter キーで発火 */
  readonly submitted = output<LoginSubmit>();

  protected readonly userId = signal('');
  protected readonly password = signal('');

  protected readonly canSubmit = computed(
    () => this.userId().trim() !== '' && this.password() !== '',
  );

  protected onSubmit(): void {
    if (this.loading() || !this.canSubmit()) {
      return;
    }
    this.submitted.emit({
      userId: this.userId().trim(),
      password: this.password(),
    });
  }
}
