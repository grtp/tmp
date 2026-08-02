// core/app-version.ts — 動作中のイメージのバージョン(IMAGE_TAG)の取得。
// frontend/Dockerfile がビルド時に version.json へ焼き込む(compose の
// build.args 経由)ため, 画面に出る値と実際に動いているイメージは
// 絶対にずれない。dev サーバーにはファイルが無いので 'dev' のまま。
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private http = inject(HttpClient);
  private loaded = false;

  /** 表示用バージョン。取得前・取得失敗時は 'dev'。 */
  readonly version = signal('dev');

  /** version.json を一度だけ読む(多重呼び出しは無視)。 */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const v = await firstValueFrom(
        this.http.get<{ version?: string }>('/version.json'),
      );
      if (v?.version) this.version.set(v.version);
    } catch {
      // version.json が無い(dev サーバー等)場合は 'dev' のまま
    }
  }
}
