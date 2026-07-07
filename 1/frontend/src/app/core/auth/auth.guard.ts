import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// authGuard restores the session (if not already loaded) and either allows the
// route or redirects to /login. Functional guards are the Angular 21 default.
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  const ok = await auth.restore();
  return ok ? true : router.createUrlTree(['/login']);
};
