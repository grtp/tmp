export function computeOffset(serverNowMs: number, sentAtMs: number, receivedAtMs: number): number {
    const rtt = receivedAtMs - sentAtMs;
    return serverNowMs - (sentAtMs + rtt / 2);
}
