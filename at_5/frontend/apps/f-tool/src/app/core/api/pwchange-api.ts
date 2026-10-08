import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PwchangeConnection, PwchangeLookupResult, PwchangeTarget, PwchangeTargetCreate, PwchangeTargetList, PwchangeTargetUpdate, PwchangeTestRequest, PwchangeTestResult, SchemaTable, SchemaTablePreview, } from '../models';
@Injectable({ providedIn: 'root' })
export class PwchangeApi {
    private http = inject(HttpClient);
    private base = '/api/v1/pwchange';
    listTargets(): Promise<PwchangeTargetList> {
        return firstValueFrom(this.http.get<PwchangeTargetList>(`${this.base}/targets`));
    }
    lookup(id: number): Promise<PwchangeLookupResult> {
        return firstValueFrom(this.http.post<PwchangeLookupResult>(`${this.base}/targets/${id}/lookup`, {}));
    }
    consent(id: number): Promise<void> {
        return firstValueFrom(this.http.post<void>(`${this.base}/targets/${id}/consent`, {}));
    }
    change(id: number, currentPassword: string, newPassword: string): Promise<void> {
        return firstValueFrom(this.http.post<void>(`${this.base}/targets/${id}/change`, { currentPassword, newPassword }));
    }
    adminListTargets(): Promise<{
        targets: PwchangeTarget[];
        alertThreshold: number;
    }> {
        return firstValueFrom(this.http.get<{
            targets: PwchangeTarget[];
            alertThreshold: number;
        }>(`${this.base}/admin/targets`));
    }
    adminCreateTarget(body: PwchangeTargetCreate): Promise<PwchangeTarget> {
        return firstValueFrom(this.http.post<PwchangeTarget>(`${this.base}/admin/targets`, body));
    }
    adminUpdateTarget(id: number, body: PwchangeTargetUpdate): Promise<PwchangeTarget> {
        return firstValueFrom(this.http.patch<PwchangeTarget>(`${this.base}/admin/targets/${id}`, body));
    }
    adminDeleteTarget(id: number): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`${this.base}/admin/targets/${id}`));
    }
    adminTest(id: number, body: PwchangeTestRequest): Promise<PwchangeTestResult> {
        return firstValueFrom(this.http.post<PwchangeTestResult>(`${this.base}/admin/targets/${id}/test`, body));
    }
    adminConnections(): Promise<PwchangeConnection[]> {
        return firstValueFrom(this.http.get<{
            connections: PwchangeConnection[];
        }>(`${this.base}/admin/connections`)).then((r) => r.connections);
    }
    adminCandidates(connectionId: number): Promise<SchemaTable[]> {
        const params = new HttpParams().set('connectionId', connectionId);
        return firstValueFrom(this.http.get<{
            tables: SchemaTable[];
        }>(`${this.base}/admin/candidates`, { params })).then((r) => r.tables);
    }
    adminColumns(connectionId: number, schema: string, table: string): Promise<SchemaTablePreview> {
        const params = new HttpParams()
            .set('connectionId', connectionId)
            .set('schema', schema)
            .set('table', table);
        return firstValueFrom(this.http.get<SchemaTablePreview>(`${this.base}/admin/columns`, { params }));
    }
}
