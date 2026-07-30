import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoService } from '@jsverse/transloco';

import {
  CellContext,
  ColumnDef,
  DataTablePage,
  TableRow,
} from '../../table-maint/data-table-page/data-table-page';
import {
  FilterColumn,
  FilterPredicate,
} from '../../shared/filter-bar/filter-model';

/** ユーザー行(権限は actionId -> level)。 */
export interface SettingsUser {
  objectGuid: string;
  username: string;
  displayName: string;
  lastLoginAt?: string;
  /** actionId -> level ('' = 権限なし) */
  levels: Record<number, string>;
}

export interface UserLevelChange {
  objectGuid: string;
  actionId: number;
  /** '' = 権限を外す */
  level: '' | 'user' | 'maintainer' | 'admin';
}

/** 権限列の見出しに使う機能情報。 */
export interface UsersGridAction {
  id: number;
  /** 機能コード(権限レベルのフィルタ列キー auth:<code> に使う) */
  code: string;
  name: string;
}

/** 表示行に埋め込む元データ参照キー。 */
const ROW_INDEX_KEY = '$i';

/**
 * ユーザー一覧グリッド(共有グリッド tm-data-table-page ベース)。
 * 列 = ユーザー + 機能ごとの権限プルダウン(actions から動的生成) + 最終ログイン。
 * 設定>ユーザー権限のほか,将来のユーザー管理機能からもそのまま使う前提で,
 * データ取得・保存は持たない(述語/ページング/権限変更はイベントで親へ)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-users-grid',
  imports: [DataTablePage, MatIcon, MatMenuModule],
  templateUrl: './users-grid.html',
  styleUrl: './users-grid.css',
})
export class UsersGrid {
  private transloco = inject(TranslocoService);

  readonly users = input<SettingsUser[]>([]);
  /** 権限列(機能)。name は呼び出し側で言語解決済み */
  readonly actions = input<UsersGridAction[]>([]);
  readonly totalCount = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly loading = input(false);
  readonly predicates = input<FilterPredicate[]>([]);

  readonly levelChanged = output<UserLevelChange>();
  readonly predicatesChange = output<FilterPredicate[]>();
  readonly pageChanged = output<number>();
  readonly pageSizeChanged = output<number>();

  // 辞書ロード完了/言語切替で見出しを再評価する
  private readonly lang = toSignal(this.transloco.selectTranslation());

  private t(key: string): string {
    void this.lang();
    return this.transloco.translate(key);
  }

  private readonly userTpl = viewChild<TemplateRef<CellContext>>('userTpl');
  private readonly levelTpl = viewChild<TemplateRef<CellContext>>('levelTpl');

  protected readonly columnDefs = computed<ColumnDef[]>(() => [
    { key: 'user', label: this.t('settings.thUser'), template: this.userTpl() },
    ...this.actions().map((a) => ({
      key: `a${a.id}`,
      label: a.name,
      template: this.levelTpl(),
      meta: a.id,
    })),
    { key: 'lastLoginAt', label: this.t('settings.thLastLogin') },
  ]);

  /** グリッドのタイトル(設定タブ名と同じ文言)。 */
  protected readonly title = computed(() => this.t('settings.tabUsers'));

  /**
   * フィルタ列。キーはバックエンド usersPredSpecs のフィールド名。
   * 機能ごとの権限レベル(auth:<code>)も enum として絞り込める
   * (例:「操作履歴が管理者」のユーザーを探す)。
   */
  protected readonly filterColumns = computed<FilterColumn[]>(() => {
    const levels = [
      { value: 'user', label: this.t('settings.levelUser') },
      { value: 'maintainer', label: this.t('settings.levelMaintainer') },
      { value: 'admin', label: this.t('settings.levelAdmin') },
    ];
    return [
      { key: 'username', label: this.t('settings.thUserId'), type: 'string' },
      { key: 'displayName', label: this.t('settings.thDisplayName'), type: 'string' },
      ...this.actions().map(
        (a): FilterColumn => ({
          key: `auth:${a.code}`,
          label: a.name,
          type: 'enum',
          enumValues: levels,
        }),
      ),
      { key: 'lastLoginAt', label: this.t('settings.thLastLogin'), type: 'datetime' },
    ];
  });

  protected readonly displayRows = computed<TableRow[]>(() =>
    this.users().map((u, i) => ({
      [ROW_INDEX_KEY]: i,
      user: '',
      lastLoginAt: u.lastLoginAt ?? '-',
    })),
  );

  /** 表示行($i 付き)から元の SettingsUser を解決する。 */
  protected rowOf(display: TableRow): SettingsUser | undefined {
    const i = display[ROW_INDEX_KEY];
    return typeof i === 'number' ? this.users()[i] : undefined;
  }

  /** 権限メニューの選択肢('' = 権限なし)。 */
  protected readonly LEVELS: UserLevelChange['level'][] = [
    '',
    'user',
    'maintainer',
    'admin',
  ];

  protected levelOf(display: TableRow, col: ColumnDef): string {
    const u = this.rowOf(display);
    return u?.levels[col.meta as number] || '';
  }

  /** レベル値の表示ラベル(言語追従)。 */
  protected levelLabel(level: string): string {
    switch (level) {
      case 'user':
        return this.t('settings.levelUser');
      case 'maintainer':
        return this.t('settings.levelMaintainer');
      case 'admin':
        return this.t('settings.levelAdmin');
      default:
        return this.t('settings.levelNone');
    }
  }

  protected onLevelChange(display: TableRow, col: ColumnDef, level: string): void {
    const u = this.rowOf(display);
    if (!u) return;
    this.levelChanged.emit({
      objectGuid: u.objectGuid,
      actionId: col.meta as number,
      level: level as UserLevelChange['level'],
    });
  }

  /** 列幅永続化を有効にするための固定キー(ユーザー数に依存しない)。 */
  protected readonly storageKey = signal('ftool.colw:settings:users');
}
