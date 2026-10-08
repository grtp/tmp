import { Injectable } from '@angular/core';
import { PasswordPolicy } from '@f-tool/ui';

export const ME = { username: 'Fuji', displayName: 'Hanako Fuji', employeeNo: '00003' as string | undefined };

const POLICY: PasswordPolicy = {
  minLen: 8,
  maxLen: 32,
  minClasses: 2,
  asciiOnly: true,
  forbidSame: true,
  forbidIdentity: true,
};

interface MockTarget {
  id: number;
  connectionName: string;
  connectionColor?: string;
  consented: boolean;
  lockedUntil: number;
  failures: number;
  maxFailures: number;
  lockMinutes: number;
  policy: PasswordPolicy;
  account: { name: string; password: string } | null;
}

/** API エラー(本物の api.Error と同じ形)。 */
export class MockApiError extends Error {
  constructor(
    readonly code: 'password_mismatch' | 'locked' | 'consent_required',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const LATENCY_MS = 350;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable({ providedIn: 'root' })
export class MockPwchangeApi {
  private readonly targets: MockTarget[] = [
    {
      id: 1, connectionName: 'StgDB', connectionColor: '#2e7d32', consented: false, lockedUntil: 0, failures: 0,
      maxFailures: 5, lockMinutes: 15, policy: POLICY, account: { name: 'Hanako Fuji', password: 'Password01!' },
    },
    {
      id: 2, connectionName: 'PrdDB', connectionColor: '#3e69ad', consented: true, lockedUntil: 0, failures: 0,
      maxFailures: 5, lockMinutes: 15, policy: POLICY, account: { name: '藤 花子', password: 'Password01!' },
    },
    {
      id: 3, connectionName: 'DevDB', connectionColor: '#6d4c9f', consented: false, lockedUntil: Date.now() + 12 * 60_000,
      failures: 0, maxFailures: 3, lockMinutes: 30, policy: POLICY, account: { name: 'Sato', password: 'Password01!' },
    },
    {
      id: 4, connectionName: 'WrDB', connectionColor: '#b45309', consented: false, lockedUntil: 0, failures: 0,
      maxFailures: 5, lockMinutes: 15, policy: POLICY, account: null,
    },
  ];

  async listTargets() {
    await delay(LATENCY_MS);
    const now = Date.now();
    return {
      employeeNo: ME.employeeNo,
      targets: this.targets.map((t) => ({
        id: t.id,
        connectionName: t.connectionName,
        connectionColor: t.connectionColor,
        consented: t.consented,
        locked: t.lockedUntil > now,
        lockRemainingSec: t.lockedUntil > now ? Math.ceil((t.lockedUntil - now) / 1000) : undefined,
        maxFailures: t.maxFailures,
        lockMinutes: t.lockMinutes,
        policy: t.policy,
      })),
    };
  }

  async lookup(id: number): Promise<{ matched: number; name?: string }> {
    await delay(LATENCY_MS);
    const t = this.get(id);
    return t.account ? { matched: 1, name: t.account.name } : { matched: 0 };
  }

  async consent(id: number): Promise<void> {
    await delay(LATENCY_MS);
    this.get(id).consented = true;
  }

  async change(id: number, currentPassword: string, newPassword: string): Promise<void> {
    await delay(LATENCY_MS);
    const t = this.get(id);
    if (t.lockedUntil > Date.now()) {
      const min = Math.ceil((t.lockedUntil - Date.now()) / 60_000);
      throw new MockApiError('locked', `失敗が続いたためロック中です。あと ${min} 分お待ちください`);
    }
    if (!t.consented) throw new MockApiError('consent_required', '先にアカウントの確認を行ってください');
    if (!t.account || t.account.password !== currentPassword) {
      t.failures += 1;
      const remaining = t.maxFailures - t.failures;
      if (remaining <= 0) {
        t.failures = 0;
        t.lockedUntil = Date.now() + t.lockMinutes * 60_000;
        throw new MockApiError(
          'password_mismatch',
          `現在のパスワードが一致しません。失敗が続いたため ${t.lockMinutes} 分間ロックします`,
          { remaining: 0, locked: true },
        );
      }
      throw new MockApiError(
        'password_mismatch',
        `現在のパスワードが一致しません(あと ${remaining} 回失敗すると ${t.lockMinutes} 分間ロックされます)`,
        { remaining, locked: false },
      );
    }
    t.account.password = newPassword;
    t.failures = 0;
  }

  private get(id: number): MockTarget {
    const t = this.targets.find((x) => x.id === id);
    if (!t) throw new Error('not found');
    return t;
  }
}
