// core/api/tables-api.ts — /api/v1/managed-tables/* の薄い HTTP 層。
// 判断や加工はしない(features 側の責務)。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BatchRequest,
  BatchResult,
  ManagedTable,
  RowPage,
  TableMeta,
} from '../models';

export interface ListRowsQuery {
  limit: number;
  offset: number;
  q?: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

@Injectable({ providedIn: 'root' })
export class TablesApi {
  private http = inject(HttpClient);
  private base = '/api/v1/managed-tables';

  listTables(all = false): Promise<ManagedTable[]> {
    const params = all ? new HttpParams().set('all', true) : undefined;
    return firstValueFrom(
      this.http.get<{ tables: ManagedTable[] }>(this.base, { params }),
    ).then((r) => r.tables);
  }

  getMeta(id: number): Promise<TableMeta> {
    return firstValueFrom(this.http.get<TableMeta>(`${this.base}/${id}/meta`));
  }

  listRows(id: number, query: ListRowsQuery): Promise<RowPage> {
    let params = new HttpParams()
      .set('limit', query.limit)
      .set('offset', query.offset);
    if (query.q) params = params.set('q', query.q);
    if (query.orderBy) {
      params = params.set('orderBy', query.orderBy).set('order', query.order ?? 'asc');
    }
    return firstValueFrom(
      this.http.get<RowPage>(`${this.base}/${id}/rows`, { params }),
    );
  }

  applyBatch(id: number, req: BatchRequest): Promise<BatchResult> {
    return firstValueFrom(
      this.http.post<BatchResult>(`${this.base}/${id}/rows/batch`, req),
    );
  }
}
