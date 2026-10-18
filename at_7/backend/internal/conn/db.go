package conn

import (
	"context"
	"database/sql"

	"f-tool/internal/appdb"
)

func (r *Repo) query(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return r.db.QueryContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) queryRow(ctx context.Context, q string, args ...any) *sql.Row {
	return r.db.QueryRowContext(ctx, appdb.Q(q), args...)
}

func (r *Repo) exec(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return r.db.ExecContext(ctx, appdb.Q(q), args...)
}
