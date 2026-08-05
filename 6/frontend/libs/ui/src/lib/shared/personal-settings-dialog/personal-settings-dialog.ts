import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import { clockTokenExamples, formatClock } from '../clock-format';

/** ヘッダー時計の表示モード。 */
export type HeaderClockMode = 'none' | 'minute' | 'second' | 'custom';

/** 個人設定の値(ユーザーごとに保持する)。 */
export interface PersonalSettings {
  headerClock: HeaderClockMode;
  headerClockFormat: string;
}

/**
 * 個人設定ダイアログ(ヘッダーのユーザーメニューから開く)。
 * 全ユーザー共通の設定(設定画面)とは別物で,ここは本人にだけ効く。
 * 変更は都度 emit し,保存はコンテナの責務(閉じるボタンだけを持つ)。
 * 書式はプレビューをローカルで即時更新し,保存(emit)は blur/Enter 時。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-personal-settings-dialog',
  imports: [MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './personal-settings-dialog.html',
  styleUrl: './personal-settings-dialog.css',
})
export class PersonalSettingsDialog {
  private readonly dialogRef =
    inject<MatDialogRef<PersonalSettingsDialog>>(MatDialogRef);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  readonly settings = input<PersonalSettings>({
    headerClock: 'minute',
    headerClockFormat: '',
  });
  readonly errorMessage = input<string | null>(null);
  /** 下部に表示するバージョン(IMAGE_TAG)。'' なら出さない */
  readonly version = input('');

  readonly clockModeChanged = output<HeaderClockMode>();
  readonly clockFormatChanged = output<string>();

  protected readonly modes: HeaderClockMode[] = ['none', 'minute', 'second', 'custom'];

  /** 書式の編集中の値(プレビュー用)。null = 未編集(settings の値を使う) */
  private readonly formatDraft = signal<string | null>(null);
  protected readonly format = computed(
    () => this.formatDraft() ?? this.settings().headerClockFormat,
  );

  protected readonly helpOpen = signal(false);

  private locale(): 'ja' | 'en' {
    return this.lang() === 'ja' ? 'ja' : 'en';
  }

  /** 書式のライブプレビュー(現在時刻)。 */
  protected readonly preview = computed(() =>
    formatClock(this.format(), new Date(), this.locale()),
  );

  /**
   * ヘルプの例示時刻は固定値 1970/01/23 14:56:43(金): 年月日時分秒の
   * 全桁が互いに異なり,どのトークンがどこに効くかが読み取りやすい。
   */
  private static readonly HELP_SAMPLE_DATE = new Date(1970, 0, 23, 14, 56, 43);

  protected readonly tokenRows = computed(() =>
    clockTokenExamples(PersonalSettingsDialog.HELP_SAMPLE_DATE, this.locale()),
  );

  /** ヘルプ見出しに添える「この例はいつの時刻か」の表示。 */
  protected readonly helpSampleLabel = computed(() =>
    formatClock(
      'yyyy/MM/dd HH:mm:ss',
      PersonalSettingsDialog.HELP_SAMPLE_DATE,
      this.locale(),
    ),
  );

  protected onFormatInput(e: Event): void {
    this.formatDraft.set((e.target as HTMLInputElement).value);
  }

  /** blur / Enter で確定して保存を依頼する。 */
  protected commitFormat(): void {
    const draft = this.formatDraft();
    if (draft !== null && draft !== this.settings().headerClockFormat) {
      this.clockFormatChanged.emit(draft);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /** disableClose で Esc は無効化されているため自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
