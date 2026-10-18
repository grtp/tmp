import { ChangeDetectionStrategy, Component, input, output, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
export interface SettingsMenuItem {
    id: string;
    name: string;
    description: string;
    icon: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-menu',
    imports: [MatIcon],
    templateUrl: './settings-menu.html',
    styleUrl: './settings-menu.css',
})
export class SettingsMenu {
    readonly items = input<SettingsMenuItem[]>([]);
    readonly itemSelected = output<string>();
}
