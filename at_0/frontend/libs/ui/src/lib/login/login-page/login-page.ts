import { ChangeDetectionStrategy, Component, computed, input, output, signal, } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';
import { LangSelect } from '../../shared/lang-select/lang-select';
export interface LoginSubmit {
    userId: string;
    password: string;
}
@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'tm-login-page',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIcon,
        MatInputModule,
        TranslocoPipe,
        LangSelect,
    ],
    templateUrl: './login-page.html',
    styleUrl: './login-page.css',
})
export class LoginPage {
    readonly systemName = input('F-tool');
    readonly version = input('');
    readonly loading = input(false);
    readonly errorMessage = input<string | null>(null);
    readonly submitted = output<LoginSubmit>();
    protected readonly userId = signal('');
    protected readonly password = signal('');
    protected readonly canSubmit = computed(() => this.userId().trim() !== '' && this.password() !== '');
    protected onSubmit(): void {
        if (this.loading() || !this.canSubmit()) {
            return;
        }
        this.submitted.emit({
            userId: this.userId().trim(),
            password: this.password(),
        });
    }
}
