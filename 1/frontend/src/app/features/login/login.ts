import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  // Pure signal state — no zone.js, no FormControl. Bindings below write these
  // directly. (Angular 21's experimental Signal Forms can replace this; see
  // README. This version is dependency-free and stable today.)
  readonly username = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.username(), this.password());
      await this.router.navigate(['/products']);
    } catch (e: unknown) {
      this.error.set(messageOf(e));
    } finally {
      this.busy.set(false);
    }
  }

  set<T>(s: { set(v: T): void }, value: T): void {
    s.set(value);
  }
}

function messageOf(e: unknown): string {
  const err = e as { error?: { error?: string }; status?: number };
  if (err?.error?.error) return err.error.error;
  if (err?.status === 0) return 'サーバーに接続できません';
  return 'ログインに失敗しました';
}
