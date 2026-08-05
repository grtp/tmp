// core/auth/auth.guard.ts — 未ログインなら /login へ,権限不足なら /home へ。
// これは UX のためのガードであり,認可の実体は Go 側の API 層にある
// (SPA のルートは全て index.html にフォールバックするため,サーバーは
// 画面単位の認可を行えない)。
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthLevel } from '../models';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const me = await auth.ensureLoaded();
  if (me) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** 機能(action)ごとの最低権限を要求するガードのファクトリ。 */
export function actionGuard(code: string, min: AuthLevel): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const me = await auth.ensureLoaded();
    if (!me) {
      return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    }
    if (auth.allows(code, min)) return true;
    return router.createUrlTree(['/home']);
  };
}
