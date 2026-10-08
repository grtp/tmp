import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { AppShell, MenuItem } from '@f-tool/ui';

import { ME } from './mock-session';
import { PwchangeContainer } from './pwchange-container';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'mock-root',
  imports: [AppShell, PwchangeContainer],
  template: `
    <tm-app-shell
      [userName]="userName"
      clockMode="minute"
      activeMenuId="pwchange"
      [menuItems]="menuItems()"
      (menuSelected)="onMenu($event)"
    >
      <mock-pwchange-container />
    </tm-app-shell>
  `,
})
export class App {
  private transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.selectTranslation());

  protected readonly userName = ME.displayName;

  protected readonly menuItems = computed<MenuItem[]>(() => {
    void this.lang();
    const t = (key: string) => this.transloco.translate(key);
    return [
      { id: 'home', label: t('menu.home'), icon: 'home' },
      { id: 'tables', label: t('menu.tables'), icon: 'table_view' },
      { id: 'pwchange', label: t('menu.pwchange'), icon: 'lock_reset' },
      { id: 'history', label: t('menu.history'), icon: 'assignment' },
      { id: 'settings', label: t('pages.settings'), icon: 'settings' },
    ];
  });

  protected onMenu(_id: string): void {
    // モック: 遷移しない
  }
}
