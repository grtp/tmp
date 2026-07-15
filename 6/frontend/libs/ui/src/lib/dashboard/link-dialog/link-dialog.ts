import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** 個人リンクカードの編集値。 */
export interface LinkDraft {
  name: string;
  url: string;
}

/**
 * 個人リンクカードの追加/編集ダイアログ(ダッシュボードから使う)。
 * タイトルと URL だけの最小フォーム。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-link-dialog',
  imports: [TranslocoPipe],
  templateUrl: './link-dialog.html',
  styleUrl: './link-dialog.css',
})
export class LinkDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集時の初期値(open 時に取り込む) */
  readonly value = input<LinkDraft | null>(null);
  readonly saving = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly saved = output<LinkDraft>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly url = signal('');

  protected readonly canSave = computed(
    () => this.name().trim() !== '' && /^https?:\/\/.+/.test(this.url().trim()),
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.name.set(this.value()?.name ?? '');
        this.url.set(this.value()?.url ?? '');
      }
    });
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saved.emit({ name: this.name().trim(), url: this.url().trim() });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.saving()) {
      this.cancelled.emit();
    }
  }
}
