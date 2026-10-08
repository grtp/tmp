import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { PwchangeLookup, PwchangePage, PwchangeSubmit, PwchangeTargetCard } from '@f-tool/ui';

import { ME, MockApiError, MockPwchangeApi } from './mock-session';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'mock-pwchange-container',
  styles: ':host { display: contents; }',
  imports: [PwchangePage],
  template: `
    <tm-pwchange-page
    [employeeNo]="employeeNo()"
    [identity]="identity()"
    [targets]="targets()"
    [loading]="loading()"
    [selectedId]="selectedId()"
    [lookup]="lookup()"
    [busy]="busy()"
    [errorMessage]="errorMessage()"
    [done]="done()"
    (targetSelected)="onSelect($event)"
    (consentClicked)="onConsent()"
    (changeSubmitted)="onChange($event)"
    (backClicked)="onBack()"
  />`,
})
export class PwchangeContainer {
  private api = inject(MockPwchangeApi);
  private transloco = inject(TranslocoService);

  protected readonly loading = signal(true);
  protected readonly employeeNo = signal<string | undefined>(undefined);
  protected readonly targets = signal<PwchangeTargetCard[]>([]);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly lookup = signal<PwchangeLookup | null>(null);
  protected readonly busy = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly done = signal(false);

  protected readonly identity = computed(() => [ME.username]);

  constructor() {
    void this.load();
  }

  private errorText(err: unknown, fallbackKey: string): string {
    const fallback = this.transloco.translate(fallbackKey);
    if (!(err instanceof MockApiError)) return fallback;
    if (this.transloco.getActiveLang() === 'ja') return err.message || fallback;
    const key = `errors.${err.code}`;
    const translated = this.transloco.translate(key);
    return translated && translated !== key ? translated : err.message || fallback;
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const res = await this.api.listTargets();
      this.employeeNo.set(res.employeeNo);
      this.targets.set(
        res.targets.map((t) => ({
          id: t.id,
          connectionName: t.connectionName,
          color: t.connectionColor,
          consented: t.consented,
          locked: t.locked,
          lockRemainingSec: t.lockRemainingSec,
          maxFailures: t.maxFailures,
          lockMinutes: t.lockMinutes,
          policy: t.policy,
        })),
      );
    } catch (err) {
      this.errorMessage.set(this.errorText(err, 'errors.loadFailed'));
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  protected async onSelect(id: number): Promise<void> {
    this.errorMessage.set(null);
    this.done.set(false);
    this.lookup.set(null);
    this.selectedId.set(id);
    const r = await this.api.lookup(id);
    this.lookup.set({ matched: r.matched, name: r.name });
    const t = this.targets().find((x) => x.id === id);
    if (t?.consented && r.matched !== 1) {
      this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: false } : x)));
    }
  }

  protected async onConsent(): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    try {
      await this.api.consent(id);
      this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: true } : x)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async onChange(e: PwchangeSubmit): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    try {
      await this.api.change(id, e.currentPassword, e.newPassword);
      this.done.set(true);
      await this.load(true);
    } catch (err) {
      this.errorMessage.set(this.errorText(err, 'errors.updateFailed'));
      const code = err instanceof MockApiError ? err.code : undefined;
      const lockedNow = err instanceof MockApiError && err.details['locked'] === true;
      if (code === 'locked' || lockedNow) {
        await this.load(true);
        this.selectedId.set(null);
      } else if (code === 'consent_required') {
        this.targets.update((list) => list.map((x) => (x.id === id ? { ...x, consented: false } : x)));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected onBack(): void {
    this.errorMessage.set(null);
    this.done.set(false);
    this.lookup.set(null);
    this.selectedId.set(null);
  }
}
