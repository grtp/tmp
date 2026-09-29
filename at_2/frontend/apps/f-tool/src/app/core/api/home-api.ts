import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
export interface HomeConfigDto {
    config: string | null;
    updatedBy?: string;
    updatedAt?: string;
}
@Injectable({ providedIn: 'root' })
export class HomeApi {
    private http = inject(HttpClient);
    getHomeConfig(): Promise<HomeConfigDto> {
        return firstValueFrom(this.http.get<HomeConfigDto>('/api/v1/home-config'));
    }
    setHomeConfig(config: string | null): Promise<HomeConfigDto> {
        return firstValueFrom(this.http.put<HomeConfigDto>('/api/v1/home-config', { config }));
    }
}
