import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const PASS = process.env.DEV_PASS ?? 'Fidev01!';
const here = path.dirname(fileURLToPath(import.meta.url));
const list = path.join(here, '..', 'samba', 'data', 'ftool-users.tsv');
const users = fs
    .readFileSync(list, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t')[0]);
let ok = 0;
for (const username of users) {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    });
    if (!res.ok) {
        console.error(`login failed: ${username} ${res.status} ${await res.text().catch(() => '')}`);
        continue;
    }
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
    await fetch(`${BASE_URL}/api/v1/auth/logout`, { method: 'POST', headers: { cookie } }).catch(() => { });
    ok++;
}
console.log(`registered ${ok}/${users.length} users`);
process.exit(ok === users.length ? 0 : 1);
