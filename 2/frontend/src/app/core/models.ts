// core/models.ts — api/openapi.yaml のスキーマを写した型。契約の正は OpenAPI 側。
export type Role = 'admin' | 'maintainer' | 'user';

export interface Me {
  username: string;
  displayName: string;
  email?: string;
  role: Role;
}

export interface TableSummary {
  name: string;
  displayName: string;
  description?: string;
  writable: boolean;
}

export type ColumnType = 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'uuid';

export interface ColumnMeta {
  name: string;
  displayName?: string;
  type: ColumnType;
  nullable: boolean;
  readonly: boolean;
  required?: boolean;
  searchable?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: (string | number)[];
}

export interface TableMeta {
  name: string;
  displayName: string;
  primaryKey: string[];
  writable: boolean;
  hasRowVersion?: boolean;
  columns: ColumnMeta[];
}

/** 列名→値。rowversion は予約キー $rowVersion で運ばれる(Phase 2 契約)。 */
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
