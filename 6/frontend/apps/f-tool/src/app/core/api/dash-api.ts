// core/api/dash-api.ts — ダッシュボードテンプレートと自分のダッシュボード設定。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DashTemplate, DashTemplateItemInput, UserDashboard } from '../models';

@Injectable({ providedIn: 'root' })
export class DashApi {
  private http = inject(HttpClient);

  // ------------------------------------------------------- templates

  listTemplates(all = false): Promise<DashTemplate[]> {
    const params = all ? new HttpParams().set('all', true) : undefined;
    return firstValueFrom(
      this.http.get<{ templates: DashTemplate[] }>('/api/v1/dash-templates', { params }),
    ).then((r) => r.templates);
  }

  getTemplate(id: number): Promise<DashTemplate> {
    return firstValueFrom(this.http.get<DashTemplate>(`/api/v1/dash-templates/${id}`));
  }

  createTemplate(body: {
    name: string;
    description?: string;
    enabled?: boolean;
    /** true = 呼び出しユーザー専用の個人テンプレート(admin 不要) */
    personal?: boolean;
  }): Promise<DashTemplate> {
    return firstValueFrom(this.http.post<DashTemplate>('/api/v1/dash-templates', body));
  }

  updateTemplate(
    id: number,
    body: Partial<Pick<DashTemplate, 'name' | 'description' | 'enabled'>>,
  ): Promise<DashTemplate> {
    return firstValueFrom(this.http.patch<DashTemplate>(`/api/v1/dash-templates/${id}`, body));
  }

  deleteTemplate(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/dash-templates/${id}`));
  }

  setTemplateItems(id: number, items: DashTemplateItemInput[]): Promise<DashTemplate> {
    return firstValueFrom(
      this.http.put<DashTemplate>(`/api/v1/dash-templates/${id}/items`, { items }),
    );
  }

  // ---------------------------------------------------- me/dashboard

  getMyDashboard(): Promise<UserDashboard> {
    return firstValueFrom(this.http.get<UserDashboard>('/api/v1/me/dashboard'));
  }

  setMyDashboard(body: UserDashboard): Promise<UserDashboard> {
    return firstValueFrom(this.http.put<UserDashboard>('/api/v1/me/dashboard', body));
  }
}
