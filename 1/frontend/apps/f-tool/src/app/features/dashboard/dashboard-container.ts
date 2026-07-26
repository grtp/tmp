// features/dashboard — カードの合成と並べ替え・テンプレート適用を担うコンテナ。
//
// カードの構成(実体化コピー方式。2026-07-23 改定):
//   - サーバーの項目(/me/dash-items)を position 順にそのまま表示する。0件なら
//     空のまま表示し，権限のある全機能への自動フォールバックはしない
//     (ユーザーが明示的に操作するまでダッシュボードは勝手に変わらない)。
//   - テンプレート選択の「既定」は，その時点で権限のある全機能を実体化
//     コピーする明示操作(onTemplateSelected の id=null)。
//   - 権限を失った action/table 項目は描画時に除外するだけで削除はしない。
// 並べ替え・追加・削除・テンプレート適用は全て /me/dash-items の全置換(PUT)で行う。
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  AddFeatureDialog,
  DashCard,
  DashboardPage,
  LinkDialog,
  LinkDialogData,
  LinkDraft,
  PickableTable,
  SelectableTemplate,
  ShortcutFunction,
} from '@f-tool/ui';

import { apiErrorText } from '../../core/api-errors';
import { confirmThen, openModal } from '../../core/dialog';
import { DashApi } from '../../core/api/dash-api';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { cardsToItemInputs, DashItemInputLike } from './dash-cards';
import { fnLabel } from '../../core/fn-label';
import { DashTemplate, DashTemplateItem, UserDashItem } from '../../core/models';

/** カードに出さない機能(サイドバーに移動済み)。 */
const SIDEBAR_ONLY = new Set(['settings', 'history']);

/**
 * テンプレート選択ダイアログの selectedId に渡す値。実体化コピー方式では
 * 「適用」は一度きりのコピーで持続的な選択状態を持たないため，どの選択肢にも
 * チェックを付けない(t.id は常に正の整数なので衝突しない)。
 */
const NO_TEMPLATE_SELECTED = -1;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-container',
  // シェル(tm-app-shell)の flex レイアウトに素通しする(自身の箱を持たない)。
  styles: ':host { display: contents; }',
  imports: [DashboardPage],
  templateUrl: './dashboard-container.html',
})
export class DashboardContainer {
  private auth = inject(AuthService);
  private dialogSvc = inject(MatDialog);
  private router = inject(Router);
  private transloco = inject(TranslocoService);
  private dashApi = inject(DashApi);
  private tablesApi = inject(TablesApi);

  /**
   * 辞書ロード完了と言語切替で computed を再評価させるための signal。
   * langChanges$ だと直リロード時(辞書ロード前に translate() が走る)に
   * 生キーのまま固まるため，selectTranslation() でロードも発火させる。
   */
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = computed(
    () => this.auth.me()?.displayName ?? '',
  );

  private readonly greetingKey = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'dashboard.greetingMorning';
    if (h >= 11 && h < 18) return 'dashboard.greetingDay';
    return 'dashboard.greetingEvening';
  })();

  protected readonly greeting = computed(() => {
    void this.lang();
    return this.transloco.translate(this.greetingKey, {
      name: this.userName(),
    });
  });

  /** サーバー側の実体化済みダッシュボード項目(空 = 空のダッシュボード)。 */
  private readonly items = signal<UserDashItem[]>([]);

  /**
   * 機能の表示名。組込機能(functions.<code> の辞書キーがあるもの)は言語切替に
   * 追従させ，キーが無いカスタム機能は DB の名前をそのまま使う。
   * (リンクカードの名前などユーザー入力値は翻訳しない)
   */
  private fnLabel(code: string, fallback: string): string {
    return fnLabel(this.transloco, code, fallback);
  }

  protected readonly cards = computed<DashCard[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    const base: DashCard[] = [];
    // テーブルカードの権限表示は table-maint の付与レベルをそのまま使う。
    const tmGrant = this.auth.actions().find((a) => a.code === 'table-maint');
    const tmPermission = tmGrant?.authLevel === 'user' ? 'view' : 'edit';
    const tmName = tmGrant ? this.fnLabel(tmGrant.code, tmGrant.name) : '';

    for (const it of this.items()) {
      if (it.kind === 'action') {
        const grant = this.auth
          .actions()
          .find((a) => a.code === it.actionCode);
        if (!grant || SIDEBAR_ONLY.has(grant.code)) continue;
        base.push({
          key: `item:${it.id}`,
          kind: 'function',
          name: this.fnLabel(grant.code, grant.name),
          icon: grant.icon,
          code: grant.code,
          permission: grant.authLevel === 'user' ? 'view' : 'edit',
        });
      } else if (it.kind === 'table') {
        if (!tmGrant || !it.managedTableId) continue;
        // 粒度統一: 1行目=機能名，2行目(詳細)=対象テーブル名。
        base.push({
          key: `item:${it.id}`,
          kind: 'table',
          name: tmName,
          detail: it.managedTableName ?? '',
          icon: it.icon || 'table_view',
          tableId: it.managedTableId,
          permission: tmPermission,
        });
      } else {
        base.push({
          key: `item:${it.id}`,
          kind: 'link',
          name: it.name ?? '',
          detail: it.url,
          icon: it.icon || 'open_in_new',
          url: it.url,
        });
      }
    }
    return base;
  });

  /**
   * カード0件時の案内文キー。ダッシュボードに出せる権限がそもそも無い場合と，
   * 自分でカードを全て消した(または未設定の)場合で文言を分ける。
   */
  protected readonly emptyKey = computed(() =>
    this.auth.actions().some((a) => !SIDEBAR_ONLY.has(a.code))
      ? 'dashboard.emptyCards'
      : 'dashboard.empty',
  );

  /**
   * 「機能へのショートカット追加」の対象機能(権限のあるもの)。
   * サイドバー専用機能は除外。table-maint は「テーブルを指定」の
   * サブ階層を持つ(将来の機能追加はこの配列に自然に増える)。
   */
  protected readonly shortcutFunctions = computed<ShortcutFunction[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    return this.auth
      .actions()
      .filter((a) => !SIDEBAR_ONLY.has(a.code))
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: this.fnLabel(a.code, a.name),
        icon: a.icon,
        hasTables: a.code === 'table-maint',
      }));
  });

  /** 並び替えモード(FAB が キャンセル/決定 に切り替わる) */
  protected readonly editMode = signal(false);

  protected readonly saving = signal(false);

  private editingItemId: number | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.items.set(await this.dashApi.getMyDashItems().catch(() => []));
  }

  protected onCard(card: DashCard): void {
    if (card.url) {
      window.open(card.url, '_blank', 'noopener');
      return;
    }
    // テーブルカードは対象テーブルの画面へ直行。
    if (card.kind === 'table' && card.tableId) {
      this.router.navigate(['/table-maint', card.tableId]);
      return;
    }
    if (card.code) {
      this.router.navigate(['/', card.code]);
    }
  }

  /** 現在の表示カードを保存用の項目配列へ変換する。 */
  private currentItemInputs(): DashItemInputLike[] {
    return cardsToItemInputs(this.cards(), this.auth.actions());
  }

  /** 項目配列をサーバーへ全置換保存し，応答で this.items を更新する。 */
  private async persist(items: DashItemInputLike[]): Promise<void> {
    this.items.set(await this.dashApi.setMyDashItems(items));
  }

  /** ドロップ確定ごとに並び順を全置換保存する(画面編集モードは継続)。 */
  protected async onOrderChanged(order: string[]): Promise<void> {
    const byKey = new Map(this.cards().map((c) => [c.key, c]));
    const ordered = order
      .map((k) => byKey.get(k))
      .filter((c): c is DashCard => !!c);
    try {
      await this.persist(cardsToItemInputs(ordered, this.auth.actions()));
    } catch {
      // 保存失敗は次回リロードで元に戻るだけ(致命ではない)。
    }
  }

  /** DashTemplate -> ダイアログ表示用。 */
  private toSelectableTemplate(t: DashTemplate): SelectableTemplate {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      personal: t.personal ?? false,
    };
  }

  /**
   * FAB 押下: ダイアログを即開き，階層ビューで使うテンプレート/テーブルの
   * 一覧は裏で取得して同じインスタンスへ setInput する(開き直しをしない
   * ので画面はちらつかない)。functions/selectedTemplateId は開いた時点の
   * スナップショットを渡す(モーダル表示中は背後の言語切替等に触れない)。
   */
  protected openAddFeature(): void {
    const ref = openModal(this.dialogSvc, AddFeatureDialog, undefined, {
      width: '26.25rem',
      maxWidth: '95vw',
    });
    ref.componentRef?.setInput('functions', this.shortcutFunctions());
    ref.componentRef?.setInput('selectedTemplateId', NO_TEMPLATE_SELECTED);

    ref.componentInstance.entrySelected.subscribe((id) =>
      this.onAddFeature(ref, id),
    );
    ref.componentInstance.linkSubmitted.subscribe((draft) =>
      void this.onLinkSubmitted(ref, draft),
    );
    ref.componentInstance.templateSaveRequested.subscribe((name) =>
      void this.onTemplateSaveRequested(ref, name),
    );
    ref.componentInstance.personalTemplateDeleted.subscribe((id) =>
      void this.onPersonalTemplateDeleted(ref, id),
    );
    ref.componentInstance.shortcutPicked.subscribe((fn) =>
      void this.onShortcutPicked(ref, fn),
    );
    ref.componentInstance.tablePicked.subscribe((t) =>
      void this.onTablePicked(ref, t),
    );
    ref.componentInstance.templateSelected.subscribe((id) =>
      void this.onTemplateSelected(ref, id),
    );

    void this.dashApi
      .listTemplates()
      .then((ts) =>
        ref.componentRef?.setInput(
          'templates',
          ts.map((t) => this.toSelectableTemplate(t)),
        ),
      )
      .catch(() => ref.componentRef?.setInput('templates', []));
    if (this.auth.allows('table-maint', 'user')) {
      void this.tablesApi
        .listTables()
        .then((tables) =>
          ref.componentRef?.setInput(
            'tables',
            tables.map((t) => ({
              id: t.id,
              displayName: t.displayName,
              schemaName: t.schemaName,
              tableName: t.tableName,
              connectionName: t.connectionName ?? undefined,
            })),
          ),
        )
        .catch(() => ref.componentRef?.setInput('tables', []));
    }
  }

  /** 即時アクションのエントリ(並び替え)。 */
  protected onAddFeature(ref: MatDialogRef<AddFeatureDialog>, entryId: string): void {
    ref.close();
    if (entryId === 'reorder') {
      this.editMode.set(true);
    }
  }

  /**
   * リンク追加(機能ショトカ追加 > リンクを追加 のフォームから)。
   * 現在の表示に1件追加して全置換保存する。失敗時はダイアログを開いた
   * ままエラーを表示する。
   */
  protected async onLinkSubmitted(
    ref: MatDialogRef<AddFeatureDialog>,
    draft: { name: string; url: string },
  ): Promise<void> {
    ref.componentRef?.setInput('saving', true);
    ref.componentRef?.setInput('errorMessage', null);
    try {
      await this.persist([
        ...this.currentItemInputs(),
        { kind: 'link', name: draft.name, url: draft.url, icon: 'open_in_new' },
      ]);
      ref.close();
    } catch (err) {
      ref.componentRef?.setInput(
        'errorMessage',
        apiErrorText(this.transloco, err, 'errors.saveFailed'),
      );
    } finally {
      ref.componentRef?.setInput('saving', false);
    }
  }

  /** DashTemplateItem -> 保存用の項目入力(コピー適用/現在の構成を保存で使う)。 */
  private templateItemToInput(item: DashTemplateItem): DashItemInputLike {
    if (item.kind === 'table') {
      return { kind: 'table', managedTableId: item.managedTableId };
    }
    if (item.kind === 'link') {
      return { kind: 'link', name: item.name, url: item.url, icon: item.icon };
    }
    return { kind: 'action', actionId: item.actionId };
  }

  /**
   * テンプレート適用(全置換方式，2026-07-22 決定): 選択したテンプレートの
   * 項目をそのままコピーして現在の項目を丸ごと置き換える。カスタマイズ
   * 済みの内容(個人カード含む)は失われる(事前に「現在の構成を保存」で
   * 退避できる)。null = 既定 = その時点で権限のある全機能を実体化コピー
   * する(2026-07-23 改定: 0件フォールバック廃止にともない，既定も明示的な
   * コピー適用になった。以後の権限変更には追従しない)。
   */
  protected async onTemplateSelected(
    ref: MatDialogRef<AddFeatureDialog>,
    id: number | null,
  ): Promise<void> {
    ref.close();
    try {
      if (id === null) {
        await this.persist(
          this.auth
            .actions()
            .filter((a) => !SIDEBAR_ONLY.has(a.code))
            .map((a): DashItemInputLike => ({ kind: 'action', actionId: a.id })),
        );
        return;
      }
      const tpl = await this.dashApi.getTemplate(id);
      const items = (tpl.items ?? [])
        .filter((it) => it.kind !== 'action' || !!it.actionId)
        .map((it) => this.templateItemToInput(it));
      await this.persist(items);
    } catch {
      // ダイアログは既に閉じている(致命ではない。次回リロードで復旧)。
    }
  }

  /**
   * 「現在の構成を保存」: 表示中の全カード構成を個人テンプレートとして
   * 作成する(2026-07-22 決定: 実体化コピー方式では個人/配布の区別が
   * 無くなったため，表示中の全カードをそのまま保存する)。現在の表示は
   * 変更しない。
   */
  protected async onTemplateSaveRequested(
    ref: MatDialogRef<AddFeatureDialog>,
    name: string,
  ): Promise<void> {
    ref.componentRef?.setInput('saving', true);
    ref.componentRef?.setInput('errorMessage', null);
    try {
      const items = this.currentItemInputs();
      const created = await this.dashApi.createTemplate({
        name,
        personal: true,
      });
      await this.dashApi.setTemplateItems(created.id, items);
      ref.close();
    } catch (err) {
      ref.componentRef?.setInput(
        'errorMessage',
        apiErrorText(this.transloco, err, 'errors.saveFailed'),
      );
    } finally {
      ref.componentRef?.setInput('saving', false);
    }
  }

  /** 個人テンプレートの削除(ダイアログは開いたまま。現在の表示には影響しない)。 */
  protected async onPersonalTemplateDeleted(
    ref: MatDialogRef<AddFeatureDialog>,
    id: number,
  ): Promise<void> {
    ref.componentRef?.setInput('saving', true);
    ref.componentRef?.setInput('errorMessage', null);
    try {
      await this.dashApi.deleteTemplate(id);
      const ts = await this.dashApi.listTemplates().catch(() => []);
      ref.componentRef?.setInput(
        'templates',
        ts.map((t) => this.toSelectableTemplate(t)),
      );
    } catch (err) {
      ref.componentRef?.setInput(
        'errorMessage',
        apiErrorText(this.transloco, err, 'errors.deleteFailed'),
      );
    } finally {
      ref.componentRef?.setInput('saving', false);
    }
  }

  /** 機能へのショートカット追加: 現在の表示に1件追加して全置換保存する。 */
  protected async onShortcutPicked(
    ref: MatDialogRef<AddFeatureDialog>,
    fn: ShortcutFunction,
  ): Promise<void> {
    ref.close();
    try {
      await this.persist([
        ...this.currentItemInputs(),
        { kind: 'action', actionId: fn.id },
      ]);
    } catch {
      // 追加失敗は次回リロードで元に戻るだけ(致命ではない)。
    }
  }

  /** テーブルカードの追加: 現在の表示に1件追加して全置換保存する。 */
  protected async onTablePicked(
    ref: MatDialogRef<AddFeatureDialog>,
    t: PickableTable,
  ): Promise<void> {
    ref.close();
    try {
      await this.persist([
        ...this.currentItemInputs(),
        { kind: 'table', managedTableId: t.id },
      ]);
    } catch {
      // 追加失敗は次回リロードで元に戻るだけ(致命ではない)。
    }
  }

  protected openLinkEdit(card: DashCard): void {
    this.openLinkDialog(
      'edit',
      { name: card.name, url: card.url ?? '' },
      Number(card.key.replace(/^item:/, '')),
    );
  }

  private openLinkDialog(
    mode: 'create' | 'edit',
    value: LinkDraft | null,
    editingId: number | null,
  ): void {
    this.editingItemId = editingId;
    const ref = openModal(
      this.dialogSvc,
      LinkDialog,
      { mode, value } satisfies LinkDialogData,
      { width: '26.25rem', maxWidth: '95vw' },
    );
    ref.componentInstance.saved.subscribe((draft) => {
      void this.onLinkSaved(ref, draft);
    });
  }

  /**
   * リンクカードの作成/編集の確定: 現在の表示に反映して全置換保存する。
   * 編集時は元の位置に挿入し直す(末尾へ飛ばない)。
   */
  protected async onLinkSaved(
    ref: MatDialogRef<LinkDialog>,
    draft: LinkDraft,
  ): Promise<void> {
    ref.componentRef?.setInput('saving', true);
    ref.componentRef?.setInput('errorMessage', null);
    try {
      const cards = this.cards();
      const editingKey =
        this.editingItemId !== null ? `item:${this.editingItemId}` : null;
      const editingCard = editingKey
        ? cards.find((c) => c.key === editingKey)
        : undefined;
      const otherCards = editingCard
        ? cards.filter((c) => c.key !== editingKey)
        : cards;
      const items = cardsToItemInputs(otherCards, this.auth.actions());
      const linkInput: DashItemInputLike = {
        kind: 'link',
        name: draft.name,
        url: draft.url,
        icon: editingCard?.icon ?? 'open_in_new',
      };
      if (editingCard) {
        items.splice(cards.indexOf(editingCard), 0, linkInput);
      } else {
        items.push(linkInput);
      }
      await this.persist(items);
      this.editingItemId = null;
      ref.close();
    } catch (err) {
      ref.componentRef?.setInput(
        'errorMessage',
        apiErrorText(this.transloco, err, 'errors.saveFailed'),
      );
    } finally {
      ref.componentRef?.setInput('saving', false);
    }
  }

  /** カードの×押下(全カード種別が対象の実削除)。 */
  protected askCardDelete(card: DashCard): void {
    confirmThen(
      this.dialogSvc,
      {
        title: this.transloco.translate('confirms.deleteCardTitle'),
        // テーブルカードは詳細(テーブル名)の方が対象を特定できる。
        message: this.transloco.translate('confirms.deleteCardMessage', {
          name: card.kind === 'table' ? (card.detail ?? card.name) : card.name,
        }),
        danger: true,
      },
      async () => {
        this.saving.set(true);
        try {
          const remaining = this.cards().filter((c) => c.key !== card.key);
          await this.persist(cardsToItemInputs(remaining, this.auth.actions()));
        } finally {
          this.saving.set(false);
        }
      },
    );
  }
}
