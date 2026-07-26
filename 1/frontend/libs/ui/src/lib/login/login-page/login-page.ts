import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';

import { LangSelect } from '../../shared/lang-select/lang-select';

export interface LoginSubmit {
  userId: string;
  password: string;
}

/**
 * ログイン画面 (A案: クラシック業務系)
 *
 * - ブランドカラーのトップボーダー付きカードを中央配置
 * - AD 認証を想定し，エラー表示とローディング状態を input で制御
 * - 言語切替(ja/en)をカード下部に持つ(選択は localStorage に永続化)
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-login-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIcon,
    MatInputModule,
    TranslocoPipe,
    LangSelect,
  ],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  /** ヘッダに表示するシステム名(ブランド名のため翻訳しない) */
  readonly systemName = input('F-tool');
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
