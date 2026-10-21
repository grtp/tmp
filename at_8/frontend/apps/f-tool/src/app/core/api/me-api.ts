import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UserSettings, ServerTime } from '../models';
@Injectable({ providedIn: 'root' })
export class MeApi {
    private http = inject(HttpClient);
    getMySettings(): Promise<UserSettings> {
        return firstValueFrom(this.http.get<UserSettings>('/api/v1/me/settings'));
    }
    getServerTime(): Promise<ServerTime> {
        return firstValueFrom(this.http.get<ServerTime>('/api/v1/me/time'));
    }
    updateMySettings(body: Partial<UserSettings>): Promise<UserSettings> {
        return firstValueFrom(this.http.patch<UserSettings>('/api/v1/me/settings', body));
    }
}
