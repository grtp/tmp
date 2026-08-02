import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  output,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';

/** 選択肢としてのテンプレート。 */
export interface SelectableTemplate {
  id: number;
  name: string;
  description?: string;
  /** true = 個人テンプレート(本人のみ)。false/undefined = 管理者配布 */
  personal?: boolean;
}

/** TemplateSelectDialogData は開く側(コンテナ)が渡す起動時固定値。 */
export interface TemplateSelectDialogData {
  templates: SelectableTemplate[];
  /** 現在選択中(null = 既定) */
  selectedId: number | null;
}

/**
 * ダッシュボードテンプレートの選択ダイアログ。
 * 「既定(権限のある全機能)」+ 管理者配布のテンプレート一覧から選ぶ。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-template-select-dialog',
  imports: [MatDialogModule, MatIcon, TranslocoPipe],
  templateUrl: './template-select-dialog.html',
  styleUrl: './template-select-dialog.css',
})
export class TemplateSelectDialog {
  private readonly data = inject<TemplateSelectDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TemplateSelectDialog>>(MatDialogRef);

  protected readonly templates = this.data.templates;
  protected readonly selectedId = this.data.selectedId;

  /** null = 既定を選択 */
  readonly templateSelected = output<number | null>();

  protected cancel(): void {
    this.dialogRef.close();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.cancel();
  }
}
