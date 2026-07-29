// core/models.ts — API 型の窓口。契約の正は api/openapi.yaml で，
// スキーマ型は gen/api-types.ts(openapi-typescript 生成物)の再エクスポート。
// spec 変更時は `npm run generate:api` で再生成する(手写しでの同期は禁止)。
// ここに手書きで残るのは，spec に無いフロント固有の型と実行時ヘルパーだけ。
import type { components } from './gen/api-types';

type S = components['schemas'];

export type AuthLevel = S['AuthLevel'];
export type GrantedAction = S['GrantedAction'];
export type Me = S['Me'];

export type DashTemplate = S['DashTemplate'];
export type DashTemplateItem = S['DashTemplateItem'];
export type DashTemplateItemInput = S['DashTemplateItemInput'];
export type UserDashItem = S['UserDashItem'];
export type UserDashItemInput = S['UserDashItemInput'];

export type ManagedTable = S['ManagedTable'];
export type FixedColumn = S['FixedColumn'];
export type TableMeta = S['TableMeta'];
export type ColumnMeta = S['ColumnMeta'];
export type ColumnType = ColumnMeta['type'];

export type Connection = S['Connection'];
export type ConnectionCreate = S['ConnectionCreate'];
export type ConnectionUpdate = S['ConnectionUpdate'];
export type ConnectionTestResult = S['ConnectionTestResult'];

/** 列名→値。rowversion は予約キー $rowVersion で運ばれる。 */
export type Row = S['Row'];
export type RowPage = S['RowPage'];
export type BatchRequest = S['BatchRequest'];
export type BatchResult = S['BatchResult'];
// updates/deletes の要素型は spec ではインライン定義なので添字で取り出す。
export type BatchUpdate = NonNullable<BatchRequest['updates']>[number];
export type BatchDelete = NonNullable<BatchRequest['deletes']>[number];

export type SchemaTable = S['SchemaTable'];
export type SchemaTablePreview = S['SchemaTablePreview'];

export type Action = S['Action'];
export type UserSettings = S['UserSettings'];
export type UserAuthEntry = S['UserAuthEntry'];
export type UserWithAuth = S['UserWithAuth'];
export type AuthAssignment = S['AuthAssignment'];

export type HistoryEntry = S['HistoryEntry'];
export type HistoryPage = S['HistoryPage'];

export type ApiError = S['Error'];

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
