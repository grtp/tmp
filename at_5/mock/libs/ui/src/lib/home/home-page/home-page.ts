import { ChangeDetectionStrategy, Component, input, output, } from '@angular/core';
import { HomeWidget, HomeWidgetView } from '../home-widget/home-widget';
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-home-page',
    imports: [HomeWidgetView],
    templateUrl: './home-page.html',
    styleUrl: './home-page.css',
})
export class HomePage {
    readonly widgets = input<HomeWidget[]>([]);
    readonly emptyText = input('');
    readonly linkOpened = output<string>();
}
