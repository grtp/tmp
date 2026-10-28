import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { MeApi } from './api/me-api';
import { computeOffset } from './server-clock-offset';
const RESYNC_MS = 10 * 60 * 1000;
const MAX_RTT_MS = 5000;
@Injectable({ providedIn: 'root' })
export class ServerClockService {
    private api = inject(MeApi);
    private destroyRef = inject(DestroyRef);
    readonly offsetMs = signal(0);
    readonly synced = signal(false);
    private timer: ReturnType<typeof setInterval> | null = null;
    private started = false;
    private readonly onVisible = (): void => {
        if (document.visibilityState === 'visible')
            void this.sync();
    };
    start(): void {
        if (this.started)
            return;
        this.started = true;
        void this.sync();
        this.timer = setInterval(() => void this.sync(), RESYNC_MS);
        document.addEventListener('visibilitychange', this.onVisible);
        this.destroyRef.onDestroy(() => this.stop());
    }
    stop(): void {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        document.removeEventListener('visibilitychange', this.onVisible);
        this.started = false;
    }
    reset(): void {
        this.stop();
        this.synced.set(false);
    }
    async sync(): Promise<void> {
        const sentAt = Date.now();
        try {
            const { now } = await this.api.getServerTime();
            const receivedAt = Date.now();
            if (receivedAt - sentAt > MAX_RTT_MS)
                return;
            const serverMs = new Date(now).getTime();
            if (Number.isNaN(serverMs))
                return;
            this.offsetMs.set(Math.round(computeOffset(serverMs, sentAt, receivedAt)));
            this.synced.set(true);
        }
        catch {
            this.synced.set(false);
        }
    }
}
