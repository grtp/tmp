import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** 選択肢としてのテンプレート。 */
export interface SelectableTemplate {
  id: number;
  name: string;
  description?: string;
  /** true = 個人テンプレート(本人のみ)。false/undefined = 管理者配布 */
  personal?: boolean;
}

/**
 * ダッシュボードテンプレートの選択ダイアログ。
 * 「既定(権限のある全機能)」+ 管理者配布のテンプレート一覧から選ぶ。
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-template-select-dialog',
  imports: [TranslocoPipe],
  templateUrl: './template-select-dialog.html',
  styleUrl: './template-select-dialog.css',
})
export class TemplateSelectDialog {
  readonly open = input(false);
  readonly templates = input<SelectableTemplate[]>([]);
  /** 現在選択中(null = 既定) */
  readonly selectedId = input<number | null>(null);

  /** null = 既定を選択 */
  readonly templateSelected = output<number | null>();
  readonly cancelled = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
