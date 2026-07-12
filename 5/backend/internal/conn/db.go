package conn

import (
	"context"
	"database/sql"

	"tablemaint/internal/appdb"
)

// アプリDB(app_connections)への実行は必ずこのヘルパを通す。
// SQL 中の `dbo.` 接頭辞を APP_DB_SCHEMA の設定値へ書き換える(appdb.Q)。

func (r *Repo) query(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return r.db.QueryContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) queryRow(ctx context.Context, q string, args ...any) *sql.Row {
	return r.db.QueryRowContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) exec(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return r.db.ExecContext(ctx, appdb.Q(q), args...)
}
