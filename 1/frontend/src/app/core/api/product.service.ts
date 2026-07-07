import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Page, Product, ProductInput, ImportResult } from '../models';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private base = '/api/products';

  list(q: string, limit: number, offset: number): Promise<Page> {
    const params = new HttpParams()
      .set('q', q)
      .set('limit', limit)
      .set('offset', offset);
    return firstValueFrom(this.http.get<Page>(this.base, { params }));
  }

  create(input: ProductInput): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(this.base, input));
  }

  update(id: number, input: ProductInput): Promise<Product> {
    return firstValueFrom(this.http.put<Product>(`${this.base}/${id}`, input));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }

  // import === bulk add. The server detects csv vs json from the filename.
  import(file: File): Promise<ImportResult> {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(
      this.http.post<ImportResult>(`${this.base}/import`, fd),
    );
  }
}
