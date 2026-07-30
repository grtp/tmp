// core/api/dash-api.ts — ダッシュボードテンプレートと自分のダッシュボード項目
// (実体化コピー方式。/me/dash-items は常に全置換)。
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  DashTemplate,
  DashTemplateItemInput,
  UserDashItem,
  UserDashItemInput,
} from '../models';

@Injectable({ providedIn: 'root' })
export class DashApi {
  private http = inject(HttpClient);

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

  getMyDashItems(): Promise<UserDashItem[]> {
    return firstValueFrom(
      this.http.get<{ items: UserDashItem[] }>('/api/v1/me/dash-items'),
    ).then((r) => r.items);
  }

  setMyDashItems(items: UserDashItemInput[]): Promise<UserDashItem[]> {
    return firstValueFrom(
      this.http.put<{ items: UserDashItem[] }>('/api/v1/me/dash-items', { items }),
    ).then((r) => r.items);
  }
}
