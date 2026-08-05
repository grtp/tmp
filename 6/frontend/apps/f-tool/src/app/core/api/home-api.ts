// core/api/home-api.ts — ホーム画面設定(/home-config)の薄い HTTP 層。
// home(表示)と settings のビルダー(S48-3)の2機能から使う。
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface HomeConfigDto {
  /** ホーム構成の JSON 文字列。null = 未設定(組込の既定表示) */
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

  /** 全置換(settings:admin)。null で未設定に戻す。 */
  setHomeConfig(config: string | null): Promise<HomeConfigDto> {
    return firstValueFrom(
      this.http.put<HomeConfigDto>('/api/v1/home-config', { config }),
    );
  }
}
