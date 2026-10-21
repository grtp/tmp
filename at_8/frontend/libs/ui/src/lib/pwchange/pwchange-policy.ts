export interface PasswordPolicy {
    minLen: number;
    maxLen: number;
    minClasses: number;
    asciiOnly: boolean;
    forbidSame: boolean;
    forbidIdentity: boolean;
}
export type PolicyItemKey = 'length' | 'classes' | 'ascii' | 'same' | 'identity' | 'confirm';
export interface PolicyItem {
    key: PolicyItemKey;
    ok: boolean;
    params: Record<string, number>;
}
export function countCharClasses(s: string): number {
    let upper = false;
    let lower = false;
    let digit = false;
    let other = false;
    for (const c of s) {
        if (/\p{Lu}/u.test(c))
            upper = true;
        else if (/\p{Ll}/u.test(c))
            lower = true;
        else if (/\p{Nd}/u.test(c))
            digit = true;
        else
            other = true;
    }
    return [upper, lower, digit, other].filter(Boolean).length;
}
export function isPrintableAscii(s: string): boolean {
    return /^[\x21-\x7e]*$/.test(s);
}
export function checkPasswordPolicy(policy: PasswordPolicy, newPw: string, currentPw: string, confirmPw: string, identity: string[]): PolicyItem[] {
    const n = [...newPw].length;
    const items: PolicyItem[] = [
        {
            key: 'length',
            ok: n >= policy.minLen && n <= policy.maxLen,
            params: { min: policy.minLen, max: policy.maxLen },
        },
    ];
    if (policy.minClasses > 0) {
        items.push({
            key: 'classes',
            ok: countCharClasses(newPw) >= policy.minClasses,
            params: { n: policy.minClasses },
        });
    }
    if (policy.asciiOnly) {
        items.push({ key: 'ascii', ok: newPw !== '' && isPrintableAscii(newPw), params: {} });
    }
    if (policy.forbidSame) {
        items.push({ key: 'same', ok: newPw !== '' && newPw !== currentPw, params: {} });
    }
    if (policy.forbidIdentity) {
        const lower = newPw.toLowerCase();
        const hit = identity
            .map((s) => s.trim().toLowerCase())
            .some((s) => [...s].length >= 3 && lower.includes(s));
        items.push({ key: 'identity', ok: newPw !== '' && !hit, params: {} });
    }
    items.push({ key: 'confirm', ok: newPw !== '' && newPw === confirmPw, params: {} });
    return items;
}
