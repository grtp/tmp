package admin

import (
	"context"
	"database/sql"

	"f-tool/internal/appdb"
)

// アプリDBへの実行は必ずこのヘルパを通す。
// SQL 中の `dbo.` 接頭辞を APP_DB_SCHEMA の設定値へ書き換える(appdb.Q)。
// トランザクション内(tx.*)で実行する場合は呼び出し側で appdb.Q を適用すること。

func (r *Repo) query(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return r.db.QueryContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) queryRow(ctx context.Context, q string, args ...any) *sql.Row {
	return r.db.QueryRowContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) exec(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return r.db.ExecContext(ctx, appdb.Q(q), args...)
}
