// features/home — ログイン後の着地ページ。home-config(グローバル JSON)を
// 取得してウィジェットレンダラ(tm-home-page)に渡す。未設定・取得失敗・
// パース不能のときは「権限のある機能カード一覧」の組込既定にフォールバック。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HomePage, HomeWidget } from '@f-tool/ui';

import { HomeApi } from '../../core/api/home-api';
import { AuthService } from '../../core/auth/auth.service';
import { fnLabel } from '../../core/fn-label';
import {
  ConfiguredWidget,
  parseHomeConfig,
  visibleWidgets,
} from './home-config';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-home-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [HomePage, TranslocoPipe],
  templateUrl: './home-container.html',
})
export class HomeContainer {
  private api = inject(HomeApi);
  private auth = inject(AuthService);
  private router = inject(Router);
  private transloco = inject(TranslocoService);

  // 辞書ロード完了/言語切替で既定カードの機能名を再評価する
  private readonly lang = toSignal(this.transloco.selectTranslation());

  /** undefined = ロード中(何も描かない。既定→設定内容への差し替わりを見せない) */
  private readonly config = signal<string | null | undefined>(undefined);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.config.set((await this.api.getHomeConfig()).config);
    } catch {
      // ホームは全員の着地点なので,取得失敗でもエラー画面にせず既定表示に落とす
      this.config.set(null);
    }
  }

  protected readonly widgets = computed<HomeWidget[] | null>(() => {
    void this.lang();
    const c = this.config();
    if (c === undefined) return null;
    const parsed = c !== null ? parseHomeConfig(c) : null;
    return visibleWidgets(parsed ?? this.fallback(), (code) =>
      this.auth.allows(code, 'user'),
    );
  });

  /** 組込の既定表示: 権限のある機能へのカード一覧。 */
  private fallback(): ConfiguredWidget[] {
    return [{
      type: 'cards',
      size: 3,
      items: this.auth.actions().map((a) => ({
        label: fnLabel(this.transloco, a.code, a.name),
        url: '/' + a.code,
        icon: a.icon,
      })),
    }];
  }

  protected open(url: string): void {
    if (url.startsWith('/')) {
      void this.router.navigateByUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }
}
