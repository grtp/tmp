// core/api/admin-api.ts — 設定画面(admin)用の薄い HTTP 層。
// managed-tables の登録/変更/削除、schema 参照、機能マスタ、ユーザー権限、履歴。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  Action,
  AuthAssignment,
  HistoryPage,
  ManagedTable,
  SchemaTable,
  SchemaTablePreview,
  UserWithAuth,
} from '../models';

export interface HistoryQuery {
  username?: string;
  actionCode?: string;
  target?: string;
  result?: 'success' | 'failure';
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private http = inject(HttpClient);

  // ---------------------------------------------------- managed tables

  createManagedTable(body: {
    schemaName: string;
    tableName: string;
    displayName: string;
    description?: string;
    sortOrder?: number;
  }): Promise<ManagedTable> {
    return firstValueFrom(this.http.post<ManagedTable>('/api/v1/managed-tables', body));
  }

  updateManagedTable(
    id: number,
    body: Partial<Pick<ManagedTable, 'displayName' | 'description' | 'sortOrder' | 'enabled'>>,
  ): Promise<ManagedTable> {
    return firstValueFrom(this.http.patch<ManagedTable>(`/api/v1/managed-tables/${id}`, body));
  }

  deleteManagedTable(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/managed-tables/${id}`));
  }

  // ------------------------------------------------------------ schema

  listSchemaTables(schema?: string): Promise<SchemaTable[]> {
    const params = schema ? new HttpParams().set('schema', schema) : undefined;
    return firstValueFrom(
      this.http.get<{ tables: SchemaTable[] }>('/api/v1/schema/tables', { params }),
    ).then((r) => r.tables);
  }

  previewSchemaTable(schema: string, table: string): Promise<SchemaTablePreview> {
    return firstValueFrom(
      this.http.get<SchemaTablePreview>(
        `/api/v1/schema/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/columns`,
      ),
    );
  }

  // ----------------------------------------------------------- actions

  listActions(): Promise<Action[]> {
    return firstValueFrom(
      this.http.get<{ actions: Action[] }>('/api/v1/admin/actions'),
    ).then((r) => r.actions);
  }

  createAction(body: {
    code: string;
    name: string;
    icon?: string;
    sortOrder?: number;
    enabled?: boolean;
  }): Promise<Action> {
    return firstValueFrom(this.http.post<Action>('/api/v1/admin/actions', body));
  }

  updateAction(
    id: number,
    body: Partial<Pick<Action, 'name' | 'icon' | 'sortOrder' | 'enabled'>>,
  ): Promise<Action> {
    return firstValueFrom(this.http.patch<Action>(`/api/v1/admin/actions/${id}`, body));
  }

  deleteAction(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/admin/actions/${id}`));
  }

  // ------------------------------------------------------------- users

  listUsers(q?: string): Promise<UserWithAuth[]> {
    const params = q ? new HttpParams().set('q', q) : undefined;
    return firstValueFrom(
      this.http.get<{ users: UserWithAuth[] }>('/api/v1/admin/users', { params }),
    ).then((r) => r.users);
  }

  setUserAuth(objectGuid: string, assignments: AuthAssignment[]): Promise<UserWithAuth> {
    return firstValueFrom(
      this.http.put<UserWithAuth>(`/api/v1/admin/users/${objectGuid}/auth`, { assignments }),
    );
  }

  // ----------------------------------------------------------- history

  listHistory(query: HistoryQuery): Promise<HistoryPage> {
    let params = new HttpParams().set('limit', query.limit).set('offset', query.offset);
    if (query.username) params = params.set('username', query.username);
    if (query.actionCode) params = params.set('actionCode', query.actionCode);
    if (query.target) params = params.set('target', query.target);
    if (query.result) params = params.set('result', query.result);
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    return firstValueFrom(this.http.get<HistoryPage>('/api/v1/history', { params }));
  }
}
