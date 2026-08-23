import type { components } from './gen/api-types';
type S = components['schemas'];
export type AuthLevel = S['AuthLevel'];
export type GrantedAction = S['GrantedAction'];
export type Me = S['Me'];
export type ManagedTable = S['ManagedTable'];
export type FixedColumn = S['FixedColumn'];
export type TableMeta = S['TableMeta'];
export type ColumnMeta = S['ColumnMeta'];
export type ColumnType = ColumnMeta['type'];
export type Connection = S['Connection'];
export type ConnectionCreate = S['ConnectionCreate'];
export type ConnectionUpdate = S['ConnectionUpdate'];
export type ConnectionTestResult = S['ConnectionTestResult'];
export type Row = S['Row'];
export type RowPage = S['RowPage'];
export type BatchRequest = S['BatchRequest'];
export type BatchResult = S['BatchResult'];
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
export function apiErrorMessage(err: unknown, fallback: string): string {
    const body = (err as {
        error?: unknown;
    })?.error;
    if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as ApiError).message;
        if (typeof m === 'string' && m)
            return m;
    }
    return fallback;
}
export function apiErrorCode(err: unknown): string | null {
    const body = (err as {
        error?: unknown;
    })?.error;
    if (body && typeof body === 'object' && 'code' in body) {
        const c = (body as ApiError).code;
        if (typeof c === 'string' && c)
            return c;
    }
    return null;
}
