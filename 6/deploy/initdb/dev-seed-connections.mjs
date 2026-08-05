// deploy/initdb/dev-seed-connections.mjs
// 開発/検証専用: backend 起動後に API 経由で「demoDB 接続」+ demo DB 上の
// 検証用テーブル(bigdata/wide/codes/audit_demo)の管理テーブル登録を行う。
//
// 背景: これらは ftool_app_connections/ftool_app_managed_tables のデータであり,
// パスワードは AES-256-GCM 暗号化して保存するため生 SQL では作れない
// (アプリの API を経由する必要がある)。01_init.sql はテーブル本体(SQL
// オブジェクト)だけを用意し,接続登録・管理テーブル登録はこのスクリプトが担う。
//
// 前提: backend が起動済み(make be_serve 等)で,ADMIN_USER が
// settings:admin を持っていること(既定のモック admin/admin は
// 01_init.sql のシードにより最初から admin 権限を持つ)。
//
// 冪等: 既に同名の接続/登録があれば何もしない。何度実行しても安全。
//
// 実行: node deploy/initdb/dev-seed-connections.mjs
// 環境変数: BASE_URL, ADMIN_USER, ADMIN_PASS,
//           DEMO_DB_HOST, DEMO_DB_PORT, DEMO_DB_NAME, DEMO_DB_USER, DEMO_DB_PASSWORD

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'admin';

const DEMO_DB = {
  name: 'demoDB',
  host: process.env.DEMO_DB_HOST ?? 'localhost',
  port: Number(process.env.DEMO_DB_PORT ?? 1433),
  databaseName: process.env.DEMO_DB_NAME ?? 'demo',
  username: process.env.DEMO_DB_USER ?? 'sa',
  password: process.env.DEMO_DB_PASSWORD ?? 'Fidev01!',
};

// 登録順が重要: products/customers(01_init.sql が既定接続で先に id 1/2 を
// 使う)に続けてこの順で登録すると,過去の開発環境と同じ id 3/4/5/6 に
// 揃い,e2e/e2e.mjs がハードコードしている managedTableId=6(audit_demo)の
// 前提と一致する。増やす場合は末尾に追加すること(途中に挿入しない)。
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
  if (!setCookie) throw new Error('login response had no Set-Cookie header');
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
  const existing = tables.find(
    (x) => x.connectionId === connectionId && x.schemaName === 'dbo' && x.tableName === t.tableName,
  );
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
