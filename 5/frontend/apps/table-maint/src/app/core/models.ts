// core/models.ts — api/openapi.yaml のスキーマを写した型。契約の正は OpenAPI 側。

/** 機能ごとの権限レベル。admin > maintainer > user。 */
export type AuthLevel = 'admin' | 'maintainer' | 'user';

export interface GrantedAction {
  id: number;
  code: string;
  name: string;
  icon: string;
  authLevel: AuthLevel;
}

export interface Me {
  username: string;
  displayName: string;
  email?: string;
  /** 権限を持つ機能(enabled のみ, sort_order 順)。ダッシュボード描画用。 */
  actions: GrantedAction[];
}

/**
 * ユーザー個人のダッシュボードカード。
 * kind='link' は任意 URL、kind='table' は管理対象テーブルへの
 * ショートカット、kind='action' は機能へのショートカット。
 */
export interface UserLink {
  id: number;
  kind: 'link' | 'table' | 'action';
  name: string;
  /** kind='link' のみ */
  url?: string;
  /** kind='table' のみ */
  managedTableId?: number;
  managedTableName?: string;
  /** kind='action' のみ */
  actionId?: number;
  actionCode?: string;
  icon: string;
  sortOrder: number;
}

// -------------------------------------------------- dashboard templates

export interface DashTemplateItem {
  id: number;
  position: number;
  kind: 'action' | 'link' | 'table';
  actionId?: number;
  actionCode?: string;
  /** kind='table' のみ */
  managedTableId?: number;
  managedTableName?: string;
  name?: string;
  url?: string;
  icon?: string;
}

export interface DashTemplate {
  id: number;
  name: string;
  description?: string;
  enabled: boolean;
  /** true = 本人だけがアクセスできる個人テンプレート(false/undefined = 配布) */
  personal?: boolean;
  items?: DashTemplateItem[];
}

/** items PUT の入力(順序 = 配列順)。 */
export interface DashTemplateItemInput {
  kind: 'action' | 'link' | 'table';
  actionId?: number;
  /** kind='table' で必須 */
  managedTableId?: number;
  name?: string;
  url?: string;
  icon?: string;
}

export interface UserDashboard {
  /** null = 既定(権限のある全機能) */
  templateId: number | null;
  /** カードキー配列(fn:<code> / mylink:<id> / tpl:<itemId>)。null = 未設定 */
  cardOrder: string[] | null;
  /** ユーザーが非表示にしたカードキー。テンプレ(再)選択でクリア=復元 */
  hiddenKeys?: string[] | null;
}

// ---------------------------------------------------------- managed tables

export interface ManagedTable {
  id: number;
  /** null/undefined = 既定接続(アプリ自身のDB) */
  connectionId?: number | null;
  connectionName?: string | null;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
  /** 呼び出しユーザーが編集可能か(table-maint:maintainer+) */
  writable: boolean;
  /** 登録時に編集不可へ指定した列名(IDENTITY 等の自動判定分は含まない) */
  readonlyColumns?: string[];
  /** 管理対象外(除外)に指定した列名。SELECT 自体から除外される */
  hiddenColumns?: string[];
}

// ------------------------------------------------------------- connections

export interface Connection {
  id: number;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  options?: string;
  enabled: boolean;
}

export interface ConnectionCreate {
  name: string;
  host: string;
  port?: number;
  databaseName: string;
  username: string;
  password: string;
  options?: string;
  enabled?: boolean;
}

export type ConnectionUpdate = Partial<ConnectionCreate>;

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

export type ColumnType = 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'uuid';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  nullable: boolean;
  readonly: boolean;
  required?: boolean;
  searchable?: boolean;
  maxLength?: number;
}

export interface TableMeta {
  id: number;
  connectionId?: number | null;
  connectionName?: string | null;
  schemaName?: string;
  tableName?: string;
  displayName: string;
  primaryKey: string[];
  writable: boolean;
  hasRowVersion: boolean;
  columns: ColumnMeta[];
  /** 除外された必須列(あると新規作成・CSV取込が不可) */
  insertBlockedColumns?: string[];
}

/** 列名→値。rowversion は予約キー $rowVersion で運ばれる。 */
export type Row = Record<string, unknown>;

export interface RowPage {
  rows: Row[];
  total: number;
  /** true のとき total は上限(10,000)で打ち切られた概算 */
  totalIsCapped?: boolean;
  limit: number;
  offset: number;
}

export interface BatchUpdate {
  key: Row;
  changes: Row;
  rowVersion?: string;
}

export interface BatchDelete {
  key: Row;
  rowVersion?: string;
}

export interface BatchRequest {
  inserts?: Row[];
  updates?: BatchUpdate[];
  deletes?: BatchDelete[];
}

export interface BatchResult {
  inserted: number;
  updated: number;
  deleted: number;
  insertedKeys?: Row[];
}

// ------------------------------------------------------------------ schema

export interface SchemaTable {
  schemaName: string;
  tableName: string;
  /** false のテーブルは登録できない(UI 側でグレーアウト) */
  hasPrimaryKey: boolean;
}

export interface SchemaTablePreview {
  schemaName: string;
  tableName: string;
  primaryKey: string[];
  hasRowVersion: boolean;
  columns: ColumnMeta[];
}

// ------------------------------------------------------------------- admin

export interface Action {
  id: number;
  code: string;
  name: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  isBuiltin: boolean;
}

export interface UserAuthEntry {
  actionId: number;
  actionCode: string;
  authLevel: AuthLevel;
}

export interface UserWithAuth {
  objectGuid: string;
  username: string;
  displayName: string;
  email?: string;
  lastLoginAt?: string;
  auth: UserAuthEntry[];
}

export interface AuthAssignment {
  actionId: number;
  authLevel: AuthLevel;
}

// ----------------------------------------------------------------- history

export interface HistoryEntry {
  id: number;
  occurredAt: string;
  objectGuid?: string;
  username: string;
  actionCode: string;
  operation: string;
  target?: string;
  detail?: Record<string, unknown>;
  result: 'success' | 'failure';
  errorCode?: string;
  clientIp?: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ------------------------------------------------------------------ errors

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** HttpErrorResponse の body から ApiError.message を安全に取り出す。 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { error?: unknown })?.error;
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as ApiError).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

/** HttpErrorResponse の body から ApiError.code を取り出す(無ければ null)。 */
export function apiErrorCode(err: unknown): string | null {
  const body = (err as { error?: unknown })?.error;
  if (body && typeof body === 'object' && 'code' in body) {
    const c = (body as ApiError).code;
    if (typeof c === 'string' && c) return c;
  }
  return null;
}
