// features/login — tm-login-page を包み、AuthService と接続する。
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { LoginPage, LoginSubmit } from '@table-maint/ui';

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
    this.errorMessage.set(null);
    try {
      await this.auth.login(e.userId, e.password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
      await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.errorMessage.set(apiErrorText(this.transloco, err, 'errors.loginFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
