// core/api/links-api.ts — 個人リンク(/api/v1/me/links)の薄い HTTP 層。
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { UserLink } from '../models';

@Injectable({ providedIn: 'root' })
export class LinksApi {
  private http = inject(HttpClient);
  private base = '/api/v1/me/links';

  list(): Promise<UserLink[]> {
    return firstValueFrom(this.http.get<{ links: UserLink[] }>(this.base)).then(
      (r) => r.links,
    );
  }

  create(body: { name: string; url: string; icon?: string }): Promise<UserLink> {
    return firstValueFrom(this.http.post<UserLink>(this.base, body));
  }

  update(id: number, body: Partial<Pick<UserLink, 'name' | 'url' | 'icon' | 'sortOrder'>>): Promise<UserLink> {
    return firstValueFrom(this.http.patch<UserLink>(`${this.base}/${id}`, body));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }
}
