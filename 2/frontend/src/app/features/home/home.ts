// features/home — トップページ。ガード通過後なのでログイン済みが前提。
// ユーザー情報と、閲覧可能なテーブルへの入口を出す。
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TablesApi } from '../../core/api/tables-api';
import { AuthService } from '../../core/auth/auth.service';
import { TableSummary } from '../../core/models';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly auth = inject(AuthService);
  private api = inject(TablesApi);

  readonly tables = signal<TableSummary[] | null>(null);

  constructor() {
    void this.api.listTables().then(
      (t) => this.tables.set(t),
      () => this.tables.set([]),
    );
  }
}
