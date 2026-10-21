import { ChangeDetectionStrategy, Component, input, output, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
export interface HomeActionItem {
    code: string;
    label: string;
    icon: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-page',
    imports: [MatIcon],
    templateUrl: './home-page.html',
    styleUrl: './home-page.css',
})
export class HomePage {
    readonly items = input<HomeActionItem[]>([]);
    readonly emptyText = input('');
    readonly actionSelected = output<string>();
}
