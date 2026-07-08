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

// ---------------------------------------------------------- managed tables

export interface ManagedTable {
  id: number;
  schemaName: string;
  tableName: string;
  displayName: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
  /** 呼び出しユーザーが編集可能か(table-maint:maintainer+) */
  writable: boolean;
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
  schemaName?: string;
  tableName?: string;
  displayName: string;
  primaryKey: string[];
  writable: boolean;
  hasRowVersion: boolean;
  columns: ColumnMeta[];
}

/** 列名→値。rowversion は予約キー $rowVersion で運ばれる。 */
export type Row = Record<string, unknown>;

export interface RowPage {
  rows: Row[];
  total: number;
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
