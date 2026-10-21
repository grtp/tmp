const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const ADMIN_USER = process.env.ADMIN_USER ?? 'local';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'Fidev01!';
const DEMO_DB = {
    name: 'demoDB',
    host: process.env.DEMO_DB_HOST ?? 'localhost',
    port: Number(process.env.DEMO_DB_PORT ?? 1433),
    databaseName: process.env.DEMO_DB_NAME ?? 'demo',
    username: process.env.DEMO_DB_USER ?? 'sa',
    password: process.env.DEMO_DB_PASSWORD ?? 'Fidev01!',
};
const TABLES = [
    { tableName: 'bigdata', displayName: 'bigdata' },
    { tableName: 'wide', displayName: 'ワイドテーブル', description: '多列/横スクロール検証用' },
    { tableName: 'codes', displayName: 'コードマスタ', description: '重複キー検証用' },
    {
        tableName: 'audit_demo',
        displayName: '監査デモ',
        hiddenColumns: ['phone'],
        readonlyColumns: ['updated_at'],
    },
];
let cookie = '';
async function api(path, opts = {}) {
    const res = await fetch(`${BASE_URL}/api/v1${path}`, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            ...opts.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status} ${body}`);
    }
    return res.status === 204 ? null : res.json();
}
async function login() {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    if (!res.ok) {
        throw new Error(`login failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie)
        throw new Error('login response had no Set-Cookie header');
    cookie = setCookie.split(';')[0];
    console.log(`logged in as ${ADMIN_USER}`);
}
async function ensureConnection() {
    const { connections } = await api('/connections');
    const existing = connections.find((c) => c.name === DEMO_DB.name);
    if (existing) {
        console.log(`connection "${DEMO_DB.name}" already exists (id=${existing.id}), skipping`);
        return existing.id;
    }
    const created = await api('/connections', {
        method: 'POST',
        body: JSON.stringify(DEMO_DB),
    });
    console.log(`created connection "${DEMO_DB.name}" (id=${created.id})`);
    return created.id;
}
async function ensureManagedTable(connectionId, t) {
    const { tables } = await api('/managed-tables?all=true');
    const existing = tables.find((x) => x.connectionId === connectionId && x.schemaName === 'dbo' && x.tableName === t.tableName);
    if (existing) {
        console.log(`managed table "${t.tableName}" already registered (id=${existing.id}), skipping`);
        return;
    }
    const created = await api('/managed-tables', {
        method: 'POST',
        body: JSON.stringify({
            connectionId,
            schemaName: 'dbo',
            tableName: t.tableName,
            displayName: t.displayName,
            description: t.description,
            hiddenColumns: t.hiddenColumns,
            readonlyColumns: t.readonlyColumns,
        }),
    });
    console.log(`registered managed table "${t.tableName}" (id=${created.id})`);
}
async function main() {
    await login();
    const connId = await ensureConnection();
    for (const t of TABLES) {
        await ensureManagedTable(connId, t);
    }
    console.log('done.');
}
main().catch((err) => {
    console.error('seed failed:', err.message);
    process.exit(1);
});
