import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthLevel } from '../models';
import { AuthService } from './auth.service';
export const authGuard: CanActivateFn = async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const me = await auth.ensureLoaded();
    if (me)
        return true;
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
export function actionGuard(code: string, min: AuthLevel): CanActivateFn {
    return async (_route, state) => {
        const auth = inject(AuthService);
        const router = inject(Router);
        const me = await auth.ensureLoaded();
        if (!me) {
            return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
        }
        if (auth.allows(code, min))
            return true;
        return router.createUrlTree(['/home']);
    };
}
