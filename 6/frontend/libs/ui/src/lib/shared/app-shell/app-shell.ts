import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import { formatClock } from '../clock-format';
import { LangSelect } from '../lang-select/lang-select';
import { UserMenu } from '../user-menu/user-menu';


export interface MenuItem {
  id: string;
  label: string;
  icon: string;
}

const SIDEBAR_COLLAPSED_KEY = 'ftool.sidebarCollapsed';

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 全画面共通のシェル(ヘッダー+サイドバー)。中身は ng-content で受け取る
 * (ダッシュボード/テーブル管理/操作履歴/設定のどの画面でも同じ構造)。
 *
 * サイドバー開閉に応じてヘッダーは テキストのみ/ロゴアイコンのみ を切り替える
 * (両方出すと F アイコン + F-tool の文字重複になるため)。ヘッダーの
 * ブランド表示自体が開閉トグルを兼ねる(トップへ戻る動線はユーザー
 * メニューの[トップへ戻る]とサイドバーの[ホーム]が担う)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-app-shell',
  imports: [
    MatButtonModule,
    MatIcon,
    MatListModule,
    MatToolbarModule,
    TranslocoPipe,
    LangSelect,
    UserMenu,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {
  /** システム名(ブランド名のため翻訳しない) */
  readonly systemName = input('F-tool');
  readonly userName = input('');
  readonly activeMenuId = input('home');
  readonly menuItems = input<MenuItem[]>([]);

  /** 'home' / 'tables' / 'history' / 'settings' / 'personal-settings' / 'logout' */
  readonly menuSelected = output<string>();

  /** サイドバー開閉(端末に localStorage で永続化)。 */
  protected readonly sidebarCollapsed = signal(loadSidebarCollapsed());

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** ヘッダー時計の表示(個人設定): なし / 分 / 秒 / カスタム書式。 */
  readonly clockMode = input<'none' | 'minute' | 'second' | 'custom'>('minute');
  /** clockMode=custom のときの書式文字列(clock-format.ts のトークン)。 */
  readonly clockFormat = input('');

  /** ヘッダー時計の現在時刻。端末のローカル時刻。 */
  private readonly now = signal(new Date());

  /**
   * minute/second — ja: 2026/07/29 (水) 01:24(:38)/ en: Jul 29, 2026 01:24。
   * custom — 書式そのまま(date は空,全体を time に入れる)。
   */
  protected readonly clock = computed(() => {
    const d = this.now();
    const ja = this.lang() === 'ja';
    if (this.clockMode() === 'custom') {
      return { date: '', time: formatClock(this.clockFormat(), d, ja ? 'ja' : 'en') };
    }
    const date = new Intl.DateTimeFormat(ja ? 'ja-JP' : 'en-US', {
      year: 'numeric',
      month: ja ? '2-digit' : 'short',
      day: ja ? '2-digit' : 'numeric',
      weekday: ja ? 'short' : undefined,
    }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: this.clockMode() === 'second' ? '2-digit' : undefined,
      hour12: false,
    }).format(d);
    return { date, time };
  });

  /** 秒単位の更新が要るか(秒表示,またはカスタム書式に秒トークンあり)。 */
  private tickEverySecond(): boolean {
    if (this.clockMode() === 'second') return true;
    return this.clockMode() === 'custom' && this.clockFormat().includes('s');
  }

  constructor() {
    // 表示の変わり目(秒が出るなら毎秒,そうでなければ毎分)に合わせて更新
    // する。一定間隔で回すと表示が最大で間隔ぶん遅れるため,次の境界まで
    // を都度計算して待つ。
    //
    // 表示モードの切り替え(個人設定の変更・ページ読み込み時の非同期反映)
    // は effect で監視し,その場でタイマーを再スケジュールする。
    // 監視せず setTimeout の再帰だけに任せると,既存のタイマーは前の
    // 間隔(最大1分)のまま残るため,切替直後は秒の数字が最大1分近く
    // 固まって見える不具合があった(表示は秒ありに変わるが,中身の
    // 時刻が更新されない)。
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = (): void => {
      const step = this.tickEverySecond() ? 1000 : 60000;
      timer = setTimeout(tick, step - (Date.now() % step) + 50);
    };
    const tick = (): void => {
      this.now.set(new Date());
      scheduleNext();
    };
    effect(() => {
      // 切替を検知するための依存
      this.clockMode();
      this.clockFormat();
      this.now.set(new Date());
      if (timer !== undefined) clearTimeout(timer);
      scheduleNext();
    });
    inject(DestroyRef).onDestroy(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  protected toggleSidebar(): void {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 永続化できなくても開閉自体は継続する
    }
  }
}
