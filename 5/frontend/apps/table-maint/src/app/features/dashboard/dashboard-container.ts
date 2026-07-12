// features/dashboard — カードの合成と並べ替え・テンプレート選択を担うコンテナ。
//
// カードの構成:
//   - テンプレート未選択(既定): 権限のある機能全部(settings/history はサイドバーへ) + 個人リンク
//   - テンプレート選択時: テンプレ項目(機能は自分の権限で絞る、リンクはそのまま) + 個人リンク
// 並び順は cardOrder(キー配列)で保存。不明キーは破棄、新カードは末尾。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  AddFeatureDialog,
  ConfirmDialog,
  DashCard,
  DashboardPage,
  LinkDialog,
  LinkDraft,
  MenuItem,
  PickableTable,
  SelectableTemplate,
  ShortcutFunction,
} from '@table-maint/ui';

import { apiErrorText } from '../../core/api-errors';
import { DashApi } from '../../core/api/dash-api';
import { LinksApi } from '../../core/api/links-api';
import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { DashTemplate, UserLink } from '../../core/models';

/** カードに出さない機能(サイドバーに移動済み)。 */
const SIDEBAR_ONLY = new Set(['settings', 'history']);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-container',
  imports: [DashboardPage, AddFeatureDialog, LinkDialog, ConfirmDialog],
  templateUrl: './dashboard-container.html',
})
export class DashboardContainer {
  private auth = inject(AuthService);
  private router = inject(Router);
  private transloco = inject(TranslocoService);
  private linksApi = inject(LinksApi);
  private dashApi = inject(DashApi);
  private tablesApi = inject(TablesApi);

  /**
   * 辞書ロード完了と言語切替で computed を再評価させるための signal。
   * langChanges$ だと直リロード時(辞書ロード前に translate() が走る)に
   * 生キーのまま固まるため、selectTranslation() でロードも発火させる。
   */
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = computed(() => this.auth.me()?.displayName ?? '');

  private readonly greetingKey = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'dashboard.greetingMorning';
    if (h >= 11 && h < 18) return 'dashboard.greetingDay';
    return 'dashboard.greetingEvening';
  })();

  protected readonly greeting = computed(() => {
    void this.lang();
    return this.transloco.translate(this.greetingKey, { name: this.userName() });
  });

  /**
   * サイドバー: ホーム / テーブルメンテ(table-maint:user+) /
   * 操作履歴(history:maintainer+) / 設定(settings:admin)。
   * 権限が無い項目は表示されず、直URLもルートガードが弾く。
   * ログアウトはヘッダーのユーザーメニュー(ドロワー)に移動した。
   */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    const items: MenuItem[] = [{ id: 'home', label: t('dashboard.menuHome'), icon: 'home' }];
    if (this.auth.allows('table-maint', 'user')) {
      items.push({ id: 'table-maint', label: t('dashboard.menuTableMaint'), icon: 'table' });
    }
    if (this.auth.allows('history', 'maintainer')) {
      items.push({ id: 'history', label: t('dashboard.menuHistory'), icon: 'history' });
    }
    if (this.auth.allows('settings', 'admin')) {
      items.push({ id: 'settings', label: t('pages.settings'), icon: 'settings' });
    }
    return items;
  });

  // ------------------------------------------------------ カードの合成
  private readonly links = signal<UserLink[]>([]);
  protected readonly templateId = signal<number | null>(null);
  private readonly template = signal<DashTemplate | null>(null);
  private readonly cardOrder = signal<string[] | null>(null);
  /** ユーザーが非表示にした非個人カードのキー(テンプレ再選択でクリア)。 */
  private readonly hiddenKeys = signal<string[]>([]);

  /**
   * 機能の表示名。組込機能(functions.<code> の辞書キーがあるもの)は言語切替に
   * 追従させ、キーが無いカスタム機能は DB の名前をそのまま使う。
   * (個人リンクの名前などユーザー入力値は翻訳しない)
   */
  private fnLabel(code: string, fallback: string): string {
    const key = `functions.${code}`;
    const v = this.transloco.translate(key);
    return v === key ? fallback : v;
  }

  protected readonly cards = computed<DashCard[]>(() => {
    void this.lang(); // 組込機能名の言語切替に追従
    const base: DashCard[] = [];
    // テーブルカードの権限表示は table-maint の付与レベルをそのまま使う。
    const tmGrant = this.auth.actions().find((a) => a.code === 'table-maint');
    const tmPermission = tmGrant?.authLevel === 'user' ? 'view' : 'edit';
    const tmName = tmGrant ? this.fnLabel(tmGrant.code, tmGrant.name) : '';

    const tpl = this.template();
    if (tpl?.items) {
      // テンプレート: 機能/テーブル項目は自分の権限にあるものだけ、リンクはそのまま。
      for (const item of tpl.items) {
        if (item.kind === 'action') {
          const grant = this.auth.actions().find((a) => a.code === item.actionCode);
          if (!grant || SIDEBAR_ONLY.has(grant.code)) continue;
          base.push({
            key: `fn:${grant.code}`,
            kind: 'function',
            name: this.fnLabel(grant.code, grant.name),
            icon: grant.icon,
            permission: grant.authLevel === 'user' ? 'view' : 'edit',
          });
        } else if (item.kind === 'table') {
          if (!tmGrant || !item.managedTableId) continue;
          // 粒度統一: 1行目=機能名、2行目(詳細)=対象テーブル名。
          base.push({
            key: `tpl:${item.id}`,
            kind: 'table',
            name: tmName,
            detail: item.managedTableName ?? item.name ?? '',
            icon: item.icon || 'table',
            tableId: item.managedTableId,
            permission: tmPermission,
          });
        } else {
          base.push({
            key: `tpl:${item.id}`,
            kind: 'link',
            name: item.name ?? '',
            detail: item.url,
            icon: item.icon || 'external-link',
            url: item.url,
          });
        }
      }
    } else {
      // 既定: 権限のある全機能(サイドバー系を除く)。
      for (const a of this.auth.actions()) {
        if (SIDEBAR_ONLY.has(a.code)) continue;
        base.push({
          key: `fn:${a.code}`,
          kind: 'function',
          name: this.fnLabel(a.code, a.name),
          icon: a.icon,
          permission: a.authLevel === 'user' ? 'view' : 'edit',
        });
      }
    }

    for (const l of this.links()) {
      if (l.kind === 'table') {
        // 権限を失ったテーブルカードは表示しない(行自体は残る)。
        if (!tmGrant || !l.managedTableId) continue;
        base.push({
          key: `mylink:${l.id}`,
          kind: 'table',
          name: tmName,
          detail: l.managedTableName ?? l.name,
          icon: l.icon || 'table',
          tableId: l.managedTableId,
          permission: tmPermission,
          personal: true,
        });
        continue;
      }
      if (l.kind === 'action') {
        // 機能へのショートカット。権限を失ったら表示しない(行自体は残る)。
        const grant = this.auth.actions().find((a) => a.code === l.actionCode);
        if (!grant) continue;
        base.push({
          key: `mylink:${l.id}`,
          kind: 'function',
          name: this.fnLabel(grant.code, grant.name),
          icon: grant.icon,
          code: grant.code,
          permission: grant.authLevel === 'user' ? 'view' : 'edit',
          personal: true,
        });
        continue;
      }
      base.push({
        key: `mylink:${l.id}`,
        kind: 'mylink',
        name: l.name,
        detail: l.url,
        icon: l.icon,
        url: l.url,
      });
    }

    // ユーザーが非表示にした非個人カードを除外(テンプレ再選択で復元)。
    const hidden = new Set(this.hiddenKeys());
    const visible =
      hidden.size === 0 ? base : base.filter((c) => c.personal || c.kind === 'mylink' || !hidden.has(c.key));

    // 保存済みの並び順を適用(不明キーは破棄、新カードは末尾)。
    const order = this.cardOrder();
    if (!order) return visible;
    const byKey = new Map(visible.map((c) => [c.key, c]));
    const out: DashCard[] = [];
    for (const key of order) {
      const c = byKey.get(key);
      if (c) {
        out.push(c);
        byKey.delete(key);
      }
    }
    out.push(...byKey.values());
    return out;
  });

  // ------------------------------------------------------ ダイアログ状態
  protected readonly addFeatureOpen = signal(false);

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

  protected readonly pickableTables = signal<PickableTable[]>([]);

  /** 並び替えモード(FAB が キャンセル/決定 に切り替わる) */
  protected readonly editMode = signal(false);

  private readonly templates = signal<DashTemplate[]>([]);
  protected readonly selectableTemplates = computed<SelectableTemplate[]>(() =>
    this.templates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      personal: t.personal ?? false,
    })),
  );

  protected readonly linkDialogOpen = signal(false);
  protected readonly linkDialogMode = signal<'create' | 'edit'>('create');
  protected readonly linkDraft = signal<LinkDraft | null>(null);
  protected readonly linkDialogError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly confirmOpen = signal(false);
  protected readonly confirmTitle = signal('');
  protected readonly confirmMessage = signal('');
  private editingLinkId: number | null = null;
  private deletingLinkId: number | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    // 個人リンクとダッシュボード設定は独立に取得(失敗しても画面は出す)。
    const [links, dash] = await Promise.all([
      this.linksApi.list().catch(() => [] as UserLink[]),
      this.dashApi
        .getMyDashboard()
        .catch(() => ({ templateId: null, cardOrder: null, hiddenKeys: null })),
    ]);
    this.links.set(links);
    this.cardOrder.set(dash.cardOrder);
    this.hiddenKeys.set(dash.hiddenKeys ?? []);
    this.templateId.set(dash.templateId);
    if (dash.templateId !== null) {
      try {
        this.template.set(await this.dashApi.getTemplate(dash.templateId));
      } catch {
        // テンプレートが消えた/無効化された -> 既定にフォールバック。
        this.template.set(null);
        this.templateId.set(null);
      }
    }
  }

  // ---------------------------------------------------------- handlers

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
    // 個人ショートカットは code を持つ。fn:<code> は key から復元(規約)。
    const code = card.code ?? card.key.replace(/^fn:/, '');
    this.router.navigate(['/', code]);
  }

  /** [決定]押下で確定した並び順を保存し、並び替えモードを抜ける。 */
  protected async onOrderChanged(order: string[]): Promise<void> {
    // 先にローカルへ反映(確定後のちらつき防止)、その後永続化。
    this.cardOrder.set(order);
    this.editMode.set(false);
    try {
      await this.dashApi.setMyDashboard({
        templateId: this.templateId(),
        cardOrder: order,
        hiddenKeys: this.hiddenKeys(),
      });
    } catch {
      // 保存失敗は次回リロードで元に戻るだけ(致命ではない)。
    }
  }

  /**
   * FAB 押下: ダイアログを即開き、階層ビューで使うテンプレート/テーブルの
   * 一覧は裏で取得する(開き直しをしないので画面はちらつかない)。
   */
  protected openAddFeature(): void {
    this.addFeatureError.set(null);
    this.addFeatureOpen.set(true);
    void this.dashApi
      .listTemplates()
      .then((ts) => this.templates.set(ts))
      .catch(() => this.templates.set([]));
    if (this.auth.allows('table-maint', 'user')) {
      void this.tablesApi
        .listTables()
        .then((tables) =>
          this.pickableTables.set(
            tables.map((t) => ({
              id: t.id,
              displayName: t.displayName,
              schemaName: t.schemaName,
              tableName: t.tableName,
              connectionName: t.connectionName ?? undefined,
            })),
          ),
        )
        .catch(() => this.pickableTables.set([]));
    }
  }

  /** 即時アクションのエントリ(並び替え)。 */
  protected onAddFeature(entryId: string): void {
    this.addFeatureOpen.set(false);
    if (entryId === 'reorder') {
      this.editMode.set(true);
    }
  }

  /**
   * リンク追加(機能ショトカ追加 > リンクを追加 のフォームから)。
   * 失敗時はダイアログを開いたままエラーを表示する。
   */
  protected readonly addFeatureError = signal<string | null>(null);

  protected async onLinkSubmitted(draft: { name: string; url: string }): Promise<void> {
    this.saving.set(true);
    this.addFeatureError.set(null);
    try {
      await this.linksApi.create(draft);
      this.addFeatureOpen.set(false);
      await this.reloadLinks();
    } catch (err) {
      this.addFeatureError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async onTemplateSelected(id: number | null): Promise<void> {
    this.addFeatureOpen.set(false);
    this.saving.set(true);
    try {
      if (id !== this.templateId()) {
        // テンプレート切替時は並び順をリセット(旧キーはほぼ無効になるため)。
        // 非表示キーもクリアする。
        await this.dashApi.setMyDashboard({ templateId: id, cardOrder: null, hiddenKeys: null });
        this.templateId.set(id);
        this.cardOrder.set(null);
        this.hiddenKeys.set([]);
        this.template.set(id !== null ? await this.dashApi.getTemplate(id) : null);
      } else {
        // 同じテンプレートの再選択 = 非表示にしたカードの復元。
        await this.dashApi.setMyDashboard({
          templateId: id,
          cardOrder: this.cardOrder(),
          hiddenKeys: null,
        });
        this.hiddenKeys.set([]);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * 「現在の構成を保存」: 表示中のカード構成(個人カードを除く)を
   * 個人テンプレートとして作成し、そのまま適用する。
   */
  protected async onTemplateSaveRequested(name: string): Promise<void> {
    this.saving.set(true);
    this.addFeatureError.set(null);
    try {
      const items = this.cards()
        .filter((c) => !c.personal && c.kind !== 'mylink')
        .map((c) => {
          if (c.kind === 'table' && c.tableId) {
            return { kind: 'table' as const, managedTableId: c.tableId };
          }
          if (c.kind === 'link') {
            return { kind: 'link' as const, name: c.name, url: c.url, icon: c.icon };
          }
          const code = c.code ?? c.key.replace(/^fn:/, '');
          const grant = this.auth.actions().find((a) => a.code === code);
          return { kind: 'action' as const, actionId: grant?.id ?? 0 };
        })
        .filter((it) => it.kind !== 'action' || it.actionId > 0);

      const created = await this.dashApi.createTemplate({ name, personal: true });
      await this.dashApi.setTemplateItems(created.id, items);
      // 保存したテンプレートをそのまま適用(構成は見た目上変わらない)。
      await this.dashApi.setMyDashboard({ templateId: created.id, cardOrder: null, hiddenKeys: null });
      this.templateId.set(created.id);
      this.cardOrder.set(null);
      this.hiddenKeys.set([]);
      this.template.set(await this.dashApi.getTemplate(created.id));
      this.addFeatureOpen.set(false);
    } catch (err) {
      this.addFeatureError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /** 個人テンプレートの削除(選択中だった場合は既定に戻る)。 */
  protected async onPersonalTemplateDeleted(id: number): Promise<void> {
    this.saving.set(true);
    this.addFeatureError.set(null);
    try {
      await this.dashApi.deleteTemplate(id);
      this.templates.set(await this.dashApi.listTemplates().catch(() => []));
      if (this.templateId() === id) {
        // サーバー側は FK SET NULL で既定に戻っている。ローカルも追従。
        this.templateId.set(null);
        this.template.set(null);
        this.cardOrder.set(null);
        this.hiddenKeys.set([]);
      }
    } catch (err) {
      this.addFeatureError.set(apiErrorText(this.transloco, err, 'errors.deleteFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /** 機能へのショートカット追加: 個人カード(kind='action')として保存する。 */
  protected async onShortcutPicked(fn: ShortcutFunction): Promise<void> {
    this.addFeatureOpen.set(false);
    this.saving.set(true);
    try {
      await this.linksApi.create({ kind: 'action', name: fn.name, actionId: fn.id });
      await this.reloadLinks();
    } finally {
      this.saving.set(false);
    }
  }

  /** テーブルカードの追加: 個人カード(kind='table')として保存する。 */
  protected async onTablePicked(t: PickableTable): Promise<void> {
    this.addFeatureOpen.set(false);
    this.saving.set(true);
    try {
      await this.linksApi.create({ kind: 'table', name: t.displayName, managedTableId: t.id });
      await this.reloadLinks();
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * 非個人カードの×押下: キーを非表示リストへ入れて保存する。
   * テンプレート(再)選択でクリアされ、カードが復元される。
   */
  protected async onHideCard(card: DashCard): Promise<void> {
    const next = [...new Set([...this.hiddenKeys(), card.key])];
    this.hiddenKeys.set(next);
    try {
      await this.dashApi.setMyDashboard({
        templateId: this.templateId(),
        cardOrder: this.cardOrder(),
        hiddenKeys: next,
      });
    } catch {
      // 保存失敗は次回リロードで元に戻るだけ(致命ではない)。
    }
  }

  // -------------------------------------------------------- 個人リンク

  private async reloadLinks(): Promise<void> {
    try {
      this.links.set(await this.linksApi.list());
    } catch {
      this.links.set([]);
    }
  }

  protected openLinkCreate(): void {
    this.linkDialogMode.set('create');
    this.editingLinkId = null;
    this.linkDraft.set(null);
    this.linkDialogError.set(null);
    this.linkDialogOpen.set(true);
  }

  protected openLinkEdit(card: DashCard): void {
    const id = Number(card.key.replace(/^mylink:/, ''));
    const link = this.links().find((l) => l.id === id);
    if (!link) return;
    this.linkDialogMode.set('edit');
    this.editingLinkId = id;
    this.linkDraft.set({ name: link.name, url: link.url ?? '' });
    this.linkDialogError.set(null);
    this.linkDialogOpen.set(true);
  }

  protected async onLinkSaved(draft: LinkDraft): Promise<void> {
    this.saving.set(true);
    this.linkDialogError.set(null);
    try {
      if (this.editingLinkId === null) {
        await this.linksApi.create(draft);
      } else {
        await this.linksApi.update(this.editingLinkId, draft);
      }
      this.linkDialogOpen.set(false);
      await this.reloadLinks();
    } catch (err) {
      this.linkDialogError.set(apiErrorText(this.transloco, err, 'errors.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected askLinkDelete(card: DashCard): void {
    this.deletingLinkId = Number(card.key.replace(/^mylink:/, ''));
    this.confirmTitle.set(this.transloco.translate('confirms.deleteLinkTitle'));
    this.confirmMessage.set(
      // テーブルカードは詳細(テーブル名)の方が対象を特定できる。
      this.transloco.translate('confirms.deleteLinkMessage', {
        name: card.kind === 'table' ? (card.detail ?? card.name) : card.name,
      }),
    );
    this.confirmOpen.set(true);
  }

  protected async onLinkDeleteConfirmed(): Promise<void> {
    if (this.deletingLinkId === null) return;
    this.saving.set(true);
    try {
      await this.linksApi.remove(this.deletingLinkId);
      this.confirmOpen.set(false);
      this.deletingLinkId = null;
      await this.reloadLinks();
    } finally {
      this.saving.set(false);
    }
  }

  protected async onMenu(id: string): Promise<void> {
    if (id === 'logout') {
      await this.auth.logout();
      this.router.navigate(['/login']);
      return;
    }
    if (id === 'home') {
      this.router.navigate(['/dashboard']);
      return;
    }
    if (id === 'table-maint') {
      this.router.navigate(['/table-maint']);
      return;
    }
    if (id === 'history') {
      this.router.navigate(['/history']);
      return;
    }
    if (id === 'settings') {
      this.router.navigate(['/settings']);
    }
  }
}
