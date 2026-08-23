import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { FilterPredicate, toPredsParam } from '@f-tool/ui';
import { firstValueFrom } from 'rxjs';
import { BatchRequest, BatchResult, ManagedTable, RowPage, TableMeta, } from '../models';
export interface ListRowsQuery {
    limit: number;
    offset: number;
    preds?: FilterPredicate[];
    orderBy?: string;
    order?: 'asc' | 'desc';
}
@Injectable({ providedIn: 'root' })
export class TablesApi {
    private http = inject(HttpClient);
    private base = '/api/v1/managed-tables';
    listTables(all = false): Promise<ManagedTable[]> {
        const params = all ? new HttpParams().set('all', true) : undefined;
        return firstValueFrom(this.http.get<{
            tables: ManagedTable[];
        }>(this.base, { params })).then((r) => r.tables);
    }
    getMeta(id: number): Promise<TableMeta> {
        return firstValueFrom(this.http.get<TableMeta>(`${this.base}/${id}/meta`));
    }
    listRows(id: number, query: ListRowsQuery): Promise<RowPage> {
        let params = new HttpParams()
            .set('limit', query.limit)
            .set('offset', query.offset);
        const preds = toPredsParam(query.preds ?? []);
        if (preds)
            params = params.set('preds', preds);
        if (query.orderBy) {
            params = params.set('orderBy', query.orderBy).set('order', query.order ?? 'asc');
        }
        return firstValueFrom(this.http.get<RowPage>(`${this.base}/${id}/rows`, { params }));
    }
    applyBatch(id: number, req: BatchRequest): Promise<BatchResult> {
        return firstValueFrom(this.http.post<BatchResult>(`${this.base}/${id}/rows/batch`, req));
    }
    exportCsvText(id: number, preds?: FilterPredicate[]): Promise<string> {
        let params = new HttpParams();
        const p = toPredsParam(preds ?? []);
        if (p)
            params = params.set('preds', p);
        return firstValueFrom(this.http.get(`${this.base}/${id}/rows/export`, { params, responseType: 'text' }));
    }
}
