// core/api/admin-api.ts — 設定画面(admin)用の薄い HTTP 層。
// managed-tables の登録/変更/削除,schema 参照,機能マスタ,ユーザー権限,履歴。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { FilterPredicate, toPredsParam } from '@f-tool/ui';
import { firstValueFrom } from 'rxjs';

import {
  Action,
  AuthAssignment,
  Connection,
  ConnectionCreate,
  ConnectionTestResult,
  ConnectionUpdate,
  FixedColumn,
  HistoryPage,
  ManagedTable,
  SchemaTable,
  SchemaTablePreview,
  UserWithAuth,
} from '../models';

export interface HistoryQuery {
  /** チップフィルタの述語配列(JSON にして preds パラメータで送る) */
  preds?: FilterPredicate[];
  limit: number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private http = inject(HttpClient);

  createManagedTable(body: {
    connectionId?: number | null;
    schemaName: string;
    tableName: string;
    displayName: string;
    description?: string;
    sortOrder?: number;
    readonlyColumns?: string[];
    hiddenColumns?: string[];
    fixedColumns?: FixedColumn[];
  }): Promise<ManagedTable> {
    return firstValueFrom(this.http.post<ManagedTable>('/api/v1/managed-tables', body));
  }

  updateManagedTable(
    id: number,
    body: Partial<
      Pick<
        ManagedTable,
        | 'displayName'
        | 'description'
        | 'sortOrder'
        | 'enabled'
        | 'readonlyColumns'
        | 'hiddenColumns'
        | 'fixedColumns'
      >
    >,
  ): Promise<ManagedTable> {
    return firstValueFrom(this.http.patch<ManagedTable>(`/api/v1/managed-tables/${id}`, body));
  }

  deleteManagedTable(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/managed-tables/${id}`));
  }

  listSchemaTables(connectionId?: number | null, schema?: string): Promise<SchemaTable[]> {
    let params = new HttpParams();
    if (connectionId != null) params = params.set('connectionId', connectionId);
    if (schema) params = params.set('schema', schema);
    return firstValueFrom(
      this.http.get<{ tables: SchemaTable[] }>('/api/v1/schema/tables', { params }),
    ).then((r) => r.tables);
  }

  previewSchemaTable(
    schema: string,
    table: string,
    connectionId?: number | null,
  ): Promise<SchemaTablePreview> {
    let params = new HttpParams();
    if (connectionId != null) params = params.set('connectionId', connectionId);
    return firstValueFrom(
      this.http.get<SchemaTablePreview>(
        `/api/v1/schema/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/columns`,
        { params },
      ),
    );
  }

  listConnections(): Promise<Connection[]> {
    return firstValueFrom(
      this.http.get<{ connections: Connection[] }>('/api/v1/connections'),
    ).then((r) => r.connections);
  }

  createConnection(body: ConnectionCreate): Promise<Connection> {
    return firstValueFrom(this.http.post<Connection>('/api/v1/connections', body));
  }

  updateConnection(id: number, body: ConnectionUpdate): Promise<Connection> {
    return firstValueFrom(this.http.patch<Connection>(`/api/v1/connections/${id}`, body));
  }

  deleteConnection(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/connections/${id}`));
  }

  testConnection(id: number): Promise<ConnectionTestResult> {
    return firstValueFrom(
      this.http.post<ConnectionTestResult>(`/api/v1/connections/${id}/test`, {}),
    );
  }

  testConnectionParams(body: ConnectionCreate): Promise<ConnectionTestResult> {
    return firstValueFrom(
      this.http.post<ConnectionTestResult>('/api/v1/connections/test', body),
    );
  }

  listActions(): Promise<Action[]> {
    return firstValueFrom(
      this.http.get<{ actions: Action[] }>('/api/v1/admin/actions'),
    ).then((r) => r.actions);
  }

  updateAction(
    id: number,
    body: Partial<Pick<Action, 'name' | 'icon' | 'sortOrder' | 'enabled'>>,
  ): Promise<Action> {
    return firstValueFrom(this.http.patch<Action>(`/api/v1/admin/actions/${id}`, body));
  }

  listUsers(query: {
    limit: number;
    offset: number;
    preds?: FilterPredicate[];
  }): Promise<{ users: UserWithAuth[]; total: number }> {
    let params = new HttpParams()
      .set('limit', query.limit)
      .set('offset', query.offset);
    const preds = toPredsParam(query.preds ?? []);
    if (preds) params = params.set('preds', preds);
    return firstValueFrom(
      this.http.get<{ users: UserWithAuth[]; total: number }>('/api/v1/admin/users', { params }),
    );
  }

  setUserAuth(objectGuid: string, assignments: AuthAssignment[]): Promise<UserWithAuth> {
    return firstValueFrom(
      this.http.put<UserWithAuth>(`/api/v1/admin/users/${objectGuid}/auth`, { assignments }),
    );
  }

  listHistory(query: HistoryQuery): Promise<HistoryPage> {
    let params = new HttpParams().set('limit', query.limit).set('offset', query.offset);
    const preds = toPredsParam(query.preds ?? []);
    if (preds) params = params.set('preds', preds);
    return firstValueFrom(this.http.get<HistoryPage>('/api/v1/history', { params }));
  }

  /** 同じフィルタ条件に一致する全履歴を CSV テキストで取得(BOM なし UTF-8)。 */
  exportHistoryCsv(preds: FilterPredicate[]): Promise<string> {
    let params = new HttpParams();
    const p = toPredsParam(preds);
    if (p) params = params.set('preds', p);
    return firstValueFrom(
      this.http.get('/api/v1/history/export', { params, responseType: 'text' }),
    );
  }

  /**
   * detail が1MBを超えて退避された全文を取得する(overflow機能が無効な
   * 環境・該当行に退避が無い場合は404)。
   */
  getHistoryOverflow(id: number): Promise<Record<string, unknown>> {
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`/api/v1/history/${id}/overflow`),
    );
  }
}
