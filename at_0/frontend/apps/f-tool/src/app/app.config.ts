import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { provideRouter } from '@angular/router';
import { provideFToolI18n } from '@f-tool/ui';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideRouter(appRoutes),
        provideFToolI18n(),
        { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } },
    ],
};
