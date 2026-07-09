// features/dashboard — /auth/me の actions を tm-dashboard-page のカードへ写す。
// ユーザー個人のリンクカード(/me/links)の追加/編集/削除もここで扱う。
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  ConfirmDialog,
  DashboardFunction,
  DashboardPage,
  LinkDialog,
  LinkDraft,
  MenuItem,
  PersonalLink,
} from '@table-maint/ui';

import { apiErrorText } from '../../core/api-errors';
import { LinksApi } from '../../core/api/links-api';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLevel, UserLink } from '../../core/models';

/** auth_level -> カードの permission 表示。 */
function toPermission(level: AuthLevel): 'edit' | 'view' {
  return level === 'user' ? 'view' : 'edit';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-dashboard-container',
  imports: [DashboardPage, LinkDialog, ConfirmDialog],
  template: `
    <tm-dashboard-page
      [userName]="userName()"
      [greeting]="greeting()"
      [menuItems]="menuItems()"
      activeMenuId="home"
      [functions]="functions()"
      [personalLinks]="personalLinks()"
      (functionSelected)="onFunction($event)"
      (menuSelected)="onMenu($event)"
      (linkSelected)="onLinkOpen($event)"
      (linkAddClicked)="openLinkCreate()"
      (linkEditClicked)="openLinkEdit($event)"
      (linkDeleteClicked)="askLinkDelete($event)"
    />

    <tm-link-dialog
      [open]="linkDialogOpen()"
      [mode]="linkDialogMode()"
      [value]="linkDraft()"
      [saving]="saving()"
      [errorMessage]="linkDialogError()"
      (saved)="onLinkSaved($event)"
      (cancelled)="linkDialogOpen.set(false)"
    />

    <tm-confirm-dialog
      [open]="confirmOpen()"
      [title]="confirmTitle()"
      [message]="confirmMessage()"
      [danger]="true"
      [busy]="saving()"
      (confirmed)="onLinkDeleteConfirmed()"
      (cancelled)="confirmOpen.set(false)"
    />
  `,
})
export class DashboardContainer {
  private auth = inject(AuthService);
  private router = inject(Router);
  private transloco = inject(TranslocoService);
  private linksApi = inject(LinksApi);

  /** 言語切替で computed を再評価させるための signal。 */
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

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

  /** サイドメニュー: ホーム + (admin は履歴) + ログアウト。 */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    const items: MenuItem[] = [{ id: 'home', label: t('dashboard.menuHome'), icon: 'home' }];
    if (this.auth.allows('settings', 'admin')) {
      items.push({ id: 'history', label: t('dashboard.menuHistory'), icon: 'history' });
    }
    items.push({ id: 'logout', label: t('common.logout'), icon: 'logout' });
    return items;
  });

  /** 権限のある機能のカード。 */
  protected readonly functions = computed<DashboardFunction[]>(() =>
    this.auth.actions().map((a) => ({
      id: a.code,
      name: a.name,
      icon: a.icon,
      permission: toPermission(a.authLevel),
    })),
  );

  // -------------------------------------------------------- 個人リンク
  private readonly links = signal<UserLink[]>([]);
  protected readonly personalLinks = computed<PersonalLink[]>(() =>
    this.links().map((l) => ({ id: l.id, name: l.name, url: l.url, icon: l.icon })),
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
    void this.reloadLinks();
  }

  private async reloadLinks(): Promise<void> {
    try {
      this.links.set(await this.linksApi.list());
    } catch {
      // 個人リンクの取得失敗でダッシュボード全体は壊さない。
      this.links.set([]);
    }
  }

  protected onLinkOpen(link: PersonalLink): void {
    window.open(link.url, '_blank', 'noopener');
  }

  protected openLinkCreate(): void {
    this.linkDialogMode.set('create');
    this.editingLinkId = null;
    this.linkDraft.set(null);
    this.linkDialogError.set(null);
    this.linkDialogOpen.set(true);
  }

  protected openLinkEdit(link: PersonalLink): void {
    this.linkDialogMode.set('edit');
    this.editingLinkId = link.id;
    this.linkDraft.set({ name: link.name, url: link.url });
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

  protected askLinkDelete(link: PersonalLink): void {
    this.deletingLinkId = link.id;
    this.confirmTitle.set(this.transloco.translate('confirms.deleteLinkTitle'));
    this.confirmMessage.set(
      this.transloco.translate('confirms.deleteLinkMessage', { name: link.name }),
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

  protected onFunction(code: string): void {
    // 組込機能はルートへ(code = ルートパスの規約)。
    this.router.navigate(['/', code]);
  }

  protected async onMenu(id: string): Promise<void> {
    if (id === 'logout') {
      await this.auth.logout();
      this.router.navigate(['/login']);
      return;
    }
    if (id === 'history') {
      this.router.navigate(['/history']);
    }
  }
}
