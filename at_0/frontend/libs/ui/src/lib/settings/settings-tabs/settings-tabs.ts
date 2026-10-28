import { ChangeDetectionStrategy, Component, input, output, } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslocoPipe } from '@jsverse/transloco';
export interface SettingsTabDef {
    id: string;
    icon: string;
    labelKey: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-settings-tabs',
    imports: [MatIcon, MatTabsModule, TranslocoPipe],
    templateUrl: './settings-tabs.html',
    styleUrl: './settings-tabs.css',
})
export class SettingsTabs {
    readonly tabs = input<SettingsTabDef[]>([]);
    readonly activeTab = input<string>('');
    readonly tabChanged = output<string>();
}
