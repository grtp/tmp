// core/api/tables-api.ts — /api/v1/tables/* の薄い HTTP 層。
// 判断や加工はしない(features 側の責務)。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { BatchRequest, BatchResult, RowPage, TableMeta, TableSummary } from '../models';

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
  private base = '/api/v1/tables';

  listTables(): Promise<TableSummary[]> {
    return firstValueFrom(
      this.http.get<{ tables: TableSummary[] }>(this.base),
    ).then((r) => r.tables);
  }

  getMeta(name: string): Promise<TableMeta> {
    return firstValueFrom(this.http.get<TableMeta>(`${this.base}/${name}/meta`));
  }

  listRows(name: string, query: ListRowsQuery): Promise<RowPage> {
    let params = new HttpParams()
      .set('limit', query.limit)
      .set('offset', query.offset);
    if (query.q) params = params.set('q', query.q);
    if (query.orderBy) {
      params = params.set('orderBy', query.orderBy).set('order', query.order ?? 'asc');
    }
    return firstValueFrom(
      this.http.get<RowPage>(`${this.base}/${name}/rows`, { params }),
    );
  }

  applyBatch(name: string, req: BatchRequest): Promise<BatchResult> {
    return firstValueFrom(
      this.http.post<BatchResult>(`${this.base}/${name}/rows/batch`, req),
    );
  }
}
