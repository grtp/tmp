import { HttpInterceptorFn } from '@angular/common/http';

// withCredentials makes the browser attach the httpOnly session cookie on
// every API call — required in dev where the SPA (4200) and API (8080) are
// different origins. In production behind one reverse proxy it is harmless.
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
