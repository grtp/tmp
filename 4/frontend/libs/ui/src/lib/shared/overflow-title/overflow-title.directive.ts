import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * セル(th/td)の文字列が省略表示(overflow:hidden + text-overflow:ellipsis)
 * で切れている間だけ,ホバー時に native title でツールチップを出す。
 * 切れていなければ何もしない(常時 title を持たせると全セルに空虚な
 * ツールチップが出てしまうため,ホバー毎に scrollWidth で判定する)。
 *
 *   <td [tmOverflowTitle]="row[col.key]">{{ row[col.key] }}</td>
 *
 * 値に null/undefined を渡すと対象外になる(バッジ・ボタン等の
 * カスタムセルは自前で title を持つため,このディレクティブでは
 * 触らない)。
 */
@Directive({
  selector: '[tmOverflowTitle]',
})
export class TmOverflowTitleDirective {
  readonly tmOverflowTitle = input<string | number | null | undefined>('');

  private el = inject<ElementRef<HTMLElement>>(ElementRef);

  @HostListener('mouseenter')
  protected onEnter(): void {
    const value = this.tmOverflowTitle();
    if (value === null || value === undefined) return;
    const host = this.el.nativeElement;
    const text = String(value);
    if (host.scrollWidth > host.clientWidth) {
      host.title = text;
    } else if (host.title === text) {
      host.removeAttribute('title');
    }
  }
}
