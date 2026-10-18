import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { FilterPredicate, toPredsParam } from '@f-tool/ui';
import { firstValueFrom } from 'rxjs';
import { Action, AuthAssignment, Connection, ConnectionCreate, ConnectionTestResult, ConnectionUpdate, DirectoryUserList, FixedColumn, Group, GroupCreate, GroupGraph, GroupMember, GroupUpdate, HistoryPage, Lookup, ManagedTable, ResourceAuthEntry, ResourceAuthLevel, ResourceType, SchemaTable, SchemaTablePreview, SubjectKind, UserRegister, UserWithAuth, } from '../models';
export interface HistoryQuery {
    preds?: FilterPredicate[];
    limit: number;
    offset: number;
    tz?: string;
}
@Injectable({ providedIn: 'root' })
export class AdminApi {
    private http = inject(HttpClient);
    createManagedTable(body: {
        connectionId?: number | null;
        schemaName: string;
        tableName: string;
        displayName: string;
        slug: string;
        description?: string;
        color?: string;
        sortOrder?: number;
        readonlyColumns?: string[];
        hiddenColumns?: string[];
        fixedColumns?: FixedColumn[];
        lookups?: Lookup[];
        columnOrder?: string[];
    }): Promise<ManagedTable> {
        return firstValueFrom(this.http.post<ManagedTable>('/api/v1/managed-tables', body));
    }
    updateManagedTable(id: number, body: Partial<Pick<ManagedTable, 'displayName' | 'slug' | 'description' | 'color' | 'sortOrder' | 'enabled' | 'readonlyColumns' | 'hiddenColumns' | 'fixedColumns' | 'lookups' | 'columnOrder'>>): Promise<ManagedTable> {
        return firstValueFrom(this.http.patch<ManagedTable>(`/api/v1/managed-tables/${id}`, body));
    }
    deleteManagedTable(id: number): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`/api/v1/managed-tables/${id}`));
    }
    listResourceAuth(type: ResourceType, id: number): Promise<ResourceAuthEntry[]> {
        return firstValueFrom(this.http.get<{
            entries: ResourceAuthEntry[];
        }>(`/api/v1/resource-auth/${type}/${id}`)).then((r) => r.entries);
    }
    setResourceAuth(type: ResourceType, id: number, subjectKind: SubjectKind, subjectId: string, authLevel: ResourceAuthLevel): Promise<ResourceAuthEntry> {
        return firstValueFrom(this.http.put<ResourceAuthEntry>(`/api/v1/resource-auth/${type}/${id}/${subjectKind}/${subjectId}`, { authLevel }));
    }
    deleteResourceAuth(type: ResourceType, id: number, subjectKind: SubjectKind, subjectId: string): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`/api/v1/resource-auth/${type}/${id}/${subjectKind}/${subjectId}`));
    }
    listGroups(): Promise<Group[]> {
        return firstValueFrom(this.http.get<{
            groups: Group[];
        }>('/api/v1/admin/groups')).then((r) => r.groups);
    }
    createGroup(body: GroupCreate): Promise<Group> {
        return firstValueFrom(this.http.post<Group>('/api/v1/admin/groups', body));
    }
    updateGroup(id: number, body: GroupUpdate): Promise<Group> {
        return firstValueFrom(this.http.patch<Group>(`/api/v1/admin/groups/${id}`, body));
    }
    deleteGroup(id: number): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`/api/v1/admin/groups/${id}`));
    }
    getGroupGraph(): Promise<GroupGraph> {
        return firstValueFrom(this.http.get<GroupGraph>('/api/v1/admin/groups/graph'));
    }
    listGroupMembers(id: number): Promise<GroupMember[]> {
        return firstValueFrom(this.http.get<{
            members: GroupMember[];
        }>(`/api/v1/admin/groups/${id}/members`)).then((r) => r.members);
    }
    addGroupMember(id: number, subjectKind: SubjectKind, subjectId: string): Promise<void> {
        return firstValueFrom(this.http.put<void>(`/api/v1/admin/groups/${id}/members/${subjectKind}/${subjectId}`, {}));
    }
    removeGroupMember(id: number, subjectKind: SubjectKind, subjectId: string): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`/api/v1/admin/groups/${id}/members/${subjectKind}/${subjectId}`));
    }
    setGroupAuth(id: number, assignments: AuthAssignment[]): Promise<Group> {
        return firstValueFrom(this.http.put<Group>(`/api/v1/admin/groups/${id}/auth`, { assignments }));
    }
    listSchemaTables(connectionId?: number | null, schema?: string, includeRegistered = false): Promise<SchemaTable[]> {
        let params = new HttpParams();
        if (connectionId != null)
            params = params.set('connectionId', connectionId);
        if (schema)
            params = params.set('schema', schema);
        if (includeRegistered)
            params = params.set('includeRegistered', true);
        return firstValueFrom(this.http.get<{
            tables: SchemaTable[];
        }>('/api/v1/schema/tables', { params })).then((r) => r.tables);
    }
    previewSchemaTable(schema: string, table: string, connectionId?: number | null): Promise<SchemaTablePreview> {
        let params = new HttpParams();
        if (connectionId != null)
            params = params.set('connectionId', connectionId);
        return firstValueFrom(this.http.get<SchemaTablePreview>(`/api/v1/schema/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/columns`, { params }));
    }
    listConnections(): Promise<Connection[]> {
        return firstValueFrom(this.http.get<{
            connections: Connection[];
        }>('/api/v1/connections')).then((r) => r.connections);
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
        return firstValueFrom(this.http.post<ConnectionTestResult>(`/api/v1/connections/${id}/test`, {}));
    }
    testConnectionParams(body: ConnectionCreate): Promise<ConnectionTestResult> {
        return firstValueFrom(this.http.post<ConnectionTestResult>('/api/v1/connections/test', body));
    }
    listActions(): Promise<Action[]> {
        return firstValueFrom(this.http.get<{
            actions: Action[];
        }>('/api/v1/admin/actions')).then((r) => r.actions);
    }
    updateAction(id: number, body: Partial<Pick<Action, 'name' | 'icon' | 'sortOrder' | 'enabled'>>): Promise<Action> {
        return firstValueFrom(this.http.patch<Action>(`/api/v1/admin/actions/${id}`, body));
    }
    listUsers(query: {
        limit: number;
        offset: number;
        preds?: FilterPredicate[];
        granted?: boolean;
        tz?: string;
    }): Promise<{
        users: UserWithAuth[];
        total: number;
    }> {
        let params = new HttpParams()
            .set('limit', query.limit)
            .set('offset', query.offset);
        const preds = toPredsParam(query.preds ?? []);
        if (preds)
            params = params.set('preds', preds);
        if (query.tz)
            params = params.set('tz', query.tz);
        if (query.granted !== undefined)
            params = params.set('granted', String(query.granted));
        return firstValueFrom(this.http.get<{
            users: UserWithAuth[];
            total: number;
        }>('/api/v1/admin/users', { params }));
    }
    searchDirectoryUsers(q: string): Promise<DirectoryUserList> {
        return firstValueFrom(this.http.get<DirectoryUserList>('/api/v1/admin/directory/users', {
            params: new HttpParams().set('q', q),
        }));
    }
    registerUser(body: UserRegister): Promise<UserWithAuth> {
        return firstValueFrom(this.http.post<UserWithAuth>('/api/v1/admin/users/register', body));
    }
    getUser(objectGuid: string): Promise<UserWithAuth> {
        return firstValueFrom(this.http.get<UserWithAuth>(`/api/v1/admin/users/${objectGuid}`));
    }
    deleteUser(objectGuid: string): Promise<void> {
        return firstValueFrom(this.http.delete<void>(`/api/v1/admin/users/${objectGuid}`));
    }
    setUserAuth(objectGuid: string, assignments: AuthAssignment[]): Promise<UserWithAuth> {
        return firstValueFrom(this.http.put<UserWithAuth>(`/api/v1/admin/users/${objectGuid}/auth`, { assignments }));
    }
    listHistory(query: HistoryQuery): Promise<HistoryPage> {
        let params = new HttpParams().set('limit', query.limit).set('offset', query.offset);
        const preds = toPredsParam(query.preds ?? []);
        if (preds)
            params = params.set('preds', preds);
        if (query.tz)
            params = params.set('tz', query.tz);
        return firstValueFrom(this.http.get<HistoryPage>('/api/v1/history', { params }));
    }
    exportHistoryCsv(preds: FilterPredicate[], tz?: string): Promise<string> {
        let params = new HttpParams();
        const p = toPredsParam(preds);
        if (p)
            params = params.set('preds', p);
        if (tz)
            params = params.set('tz', tz);
        return firstValueFrom(this.http.get('/api/v1/history/export', { params, responseType: 'text' }));
    }
    getHistoryOverflow(id: number): Promise<Record<string, unknown>> {
        return firstValueFrom(this.http.get<Record<string, unknown>>(`/api/v1/history/${id}/overflow`));
    }
}
