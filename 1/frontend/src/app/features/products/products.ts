import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ProductService } from '../../core/api/product.service';
import { Product, ProductInput, ImportResult } from '../../core/models';

type Editing = { id: number | null } | null;

const emptyDraft = (): ProductInput => ({
  code: '',
  name: '',
  category: '',
  price: 0,
  stock: 0,
});

@Component({
  selector: 'app-products',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './products.html',
  styleUrl: './products.css',
})
export class Products implements OnInit {
  private api = inject(ProductService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly user = this.auth.user;

  // --- table state ---
  readonly rows = signal<Product[]>([]);
  readonly total = signal(0);
  readonly q = signal('');
  readonly limit = signal(100); // requirement: default 100 per page
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly from = computed(() => (this.total() === 0 ? 0 : this.offset() + 1));
  readonly to = computed(() => Math.min(this.offset() + this.limit(), this.total()));
  readonly canPrev = computed(() => this.offset() > 0);
  readonly canNext = computed(() => this.offset() + this.limit() < this.total());

  // --- editor (add / edit) ---
  readonly editing = signal<Editing>(null);
  readonly draft = signal<ProductInput>(emptyDraft());
  readonly saving = signal(false);
  readonly editorError = signal('');

  // --- import ---
  readonly importResult = signal<ImportResult | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.list(this.q(), this.limit(), this.offset());
      this.rows.set(page.items);
      this.total.set(page.total);
    } catch {
      this.error.set('一覧の取得に失敗しました');
    } finally {
      this.loading.set(false);
    }
  }

  search(): void {
    this.offset.set(0);
    void this.load();
  }

  changeLimit(value: string): void {
    this.limit.set(Number(value));
    this.offset.set(0);
    void this.load();
  }

  prevPage(): void {
    if (!this.canPrev()) return;
    this.offset.set(Math.max(0, this.offset() - this.limit()));
    void this.load();
  }

  nextPage(): void {
    if (!this.canNext()) return;
    this.offset.set(this.offset() + this.limit());
    void this.load();
  }

  // --- editor actions ---
  openNew(): void {
    this.editing.set({ id: null });
    this.draft.set(emptyDraft());
    this.editorError.set('');
  }

  openEdit(p: Product): void {
    this.editing.set({ id: p.id });
    this.draft.set({
      code: p.code,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock,
    });
    this.editorError.set('');
  }

  closeEditor(): void {
    this.editing.set(null);
  }

  // Patch one field of the draft signal immutably.
  patch<K extends keyof ProductInput>(key: K, value: ProductInput[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  async saveEditor(): Promise<void> {
    const e = this.editing();
    if (!e || this.saving()) return;
    this.saving.set(true);
    this.editorError.set('');
    try {
      if (e.id === null) {
        await this.api.create(this.draft());
      } else {
        await this.api.update(e.id, this.draft());
      }
      this.closeEditor();
      await this.load();
    } catch (err: unknown) {
      this.editorError.set(messageOf(err));
    } finally {
      this.saving.set(false);
    }
  }

  async confirmDelete(p: Product): Promise<void> {
    if (!confirm(`「${p.name}」(${p.code}) を削除しますか？`)) return;
    try {
      await this.api.remove(p.id);
      await this.load();
    } catch {
      this.error.set('削除に失敗しました');
    }
  }

  // --- import (CSV / JSON => add) ---
  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.importResult.set(null);
    this.error.set('');
    try {
      const result = await this.api.import(file);
      this.importResult.set(result);
      await this.load();
    } catch (err: unknown) {
      this.error.set(messageOf(err));
    } finally {
      input.value = ''; // allow re-selecting the same file
    }
  }

  dismissImport(): void {
    this.importResult.set(null);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

function messageOf(e: unknown): string {
  const err = e as { error?: { error?: string } };
  return err?.error?.error ?? '処理に失敗しました';
}
