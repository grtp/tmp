import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return next(req).pipe(catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse &&
            err.status === 401 &&
            !req.url.includes('/auth/')) {
            auth.sessionExpired();
            router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
        return throwError(() => err);
    }));
};
