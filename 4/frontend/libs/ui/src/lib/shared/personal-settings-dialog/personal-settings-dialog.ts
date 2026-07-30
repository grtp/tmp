import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';

/** 個人設定の値(ユーザーごとに保持する)。 */
export interface PersonalSettings {
  headerClockSeconds: boolean;
}

/**
 * 個人設定ダイアログ(ヘッダーのユーザーメニューから開く)。
 * 全ユーザー共通の設定(設定画面)とは別物で,ここは本人にだけ効く。
 * 変更は都度 emit し,保存はコンテナの責務(閉じるボタンだけを持つ)。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-personal-settings-dialog',
  imports: [MatCheckboxModule, MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './personal-settings-dialog.html',
  styleUrl: './personal-settings-dialog.css',
})
export class PersonalSettingsDialog {
  private readonly dialogRef =
    inject<MatDialogRef<PersonalSettingsDialog>>(MatDialogRef);

  readonly settings = input<PersonalSettings>({ headerClockSeconds: false });
  readonly errorMessage = input<string | null>(null);

  readonly headerClockSecondsChanged = output<boolean>();

  protected close(): void {
    this.dialogRef.close();
  }

  /** disableClose で Esc は無効化されているため自前で閉じる。 */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
