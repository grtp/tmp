// features/login — tm-login-page を包み，AuthService と接続する。
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { LoginPage, LoginSubmit } from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-login-container',
  imports: [LoginPage],
  templateUrl: './login-container.html',
})
export class LoginContainer {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private transloco = inject(TranslocoService);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected async onSubmit(e: LoginSubmit): Promise<void> {
    this.loading.set(true);
    // ここで errorMessage.set(null) はしない。既にエラー表示中に再送信すると
    // 一瞬エラー欄が消えて(カードが縮み) 結果を受けてまた表示される(カードが
    // 伸びる)という二段のちらつきになるため。catch で新しい結果に上書きする。
    try {
      await this.auth.login(e.userId, e.password);
      const returnUrl =
        this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
      await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.errorMessage.set(
        apiErrorText(this.transloco, err, 'errors.loginFailed'),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
