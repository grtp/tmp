import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
@Injectable({ providedIn: 'root' })
export class AppVersionService {
    private http = inject(HttpClient);
    private loaded = false;
    readonly version = signal('dev');
    async load(): Promise<void> {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const v = await firstValueFrom(this.http.get<{
                version?: string;
            }>('/version.json'));
            if (v?.version)
                this.version.set(v.version);
        }
        catch {
        }
    }
}
