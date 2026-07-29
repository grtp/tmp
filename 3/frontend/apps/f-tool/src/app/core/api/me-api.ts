// core/api/me-api.ts — ログイン中ユーザー本人向けの API(/me/*)の薄い HTTP 層。
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { UserSettings } from '../models';

@Injectable({ providedIn: 'root' })
export class MeApi {
  private http = inject(HttpClient);

  getMySettings(): Promise<UserSettings> {
    return firstValueFrom(this.http.get<UserSettings>('/api/v1/me/settings'));
  }

  updateMySettings(body: Partial<UserSettings>): Promise<UserSettings> {
    return firstValueFrom(this.http.patch<UserSettings>('/api/v1/me/settings', body));
  }
}
