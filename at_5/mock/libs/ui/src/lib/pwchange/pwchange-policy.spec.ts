import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, countCharClasses, isPrintableAscii } from './pwchange-policy';
const policy = {
    minLen: 8,
    maxLen: 16,
    minClasses: 2,
    asciiOnly: true,
    forbidSame: true,
    forbidIdentity: true,
};
function okMap(items: ReturnType<typeof checkPasswordPolicy>): Record<string, boolean> {
    return Object.fromEntries(items.map((i) => [i.key, i.ok]));
}
describe('pwchange-policy', () => {
    it('counts character classes', () => {
        expect(countCharClasses('')).toBe(0);
        expect(countCharClasses('abcdefgh')).toBe(1);
        expect(countCharClasses('Abcdef12')).toBe(3);
        expect(countCharClasses('Ab1!')).toBe(4);
    });
    it('detects non printable ascii', () => {
        expect(isPrintableAscii('Abc123!?')).toBe(true);
        expect(isPrintableAscii('Abc 123')).toBe(false);
        expect(isPrintableAscii('ぱすわーど')).toBe(false);
    });
    it('passes a conforming password', () => {
        const r = okMap(checkPasswordPolicy(policy, 'Abcdef12', 'Old12345', 'Abcdef12', ['00123', 'sato']));
        expect(r).toEqual({ length: true, classes: true, ascii: true, same: true, identity: true, confirm: true });
    });
    it('flags each rule independently', () => {
        expect(okMap(checkPasswordPolicy(policy, 'Ab1', '', 'Ab1', [])).length).toBe(false);
        expect(okMap(checkPasswordPolicy(policy, 'abcdefgh', '', 'abcdefgh', [])).classes).toBe(false);
        expect(okMap(checkPasswordPolicy(policy, 'Abcdef 12', '', 'Abcdef 12', [])).ascii).toBe(false);
        expect(okMap(checkPasswordPolicy(policy, 'Abcdef12', 'Abcdef12', 'Abcdef12', [])).same).toBe(false);
        expect(okMap(checkPasswordPolicy(policy, 'x00123yzA', '', 'x00123yzA', ['00123'])).identity).toBe(false);
        expect(okMap(checkPasswordPolicy(policy, 'Abcdef12', '', 'Abcdef13', [])).confirm).toBe(false);
    });
    it('omits disabled rules', () => {
        const keys = checkPasswordPolicy({ ...policy, minClasses: 0, asciiOnly: false, forbidSame: false, forbidIdentity: false }, 'Abcdef12', '', 'Abcdef12', []).map((i) => i.key);
        expect(keys).toEqual(['length', 'confirm']);
    });
    it('ignores short identity strings', () => {
        expect(okMap(checkPasswordPolicy(policy, 'xyzabcdA1', '', 'xyzabcdA1', ['ab'])).identity).toBe(true);
    });
});
