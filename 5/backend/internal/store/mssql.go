// Package store owns the SQL Server connection and the metadata-driven
// dynamic CRUD: SELECT with pagination, and the single-transaction batch
// apply. メタデータは internal/meta が実行時にカタログから構築する。
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/microsoft/go-mssqldb" // driver: "sqlserver"

	"tablemaint/internal/appdb"
)

func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return db, nil
}

// VerifyAppTables fails fast when the tool's own tables are missing,
// pointing the operator at the initdb script instead of failing later
// with an obscure SQL error.
func VerifyAppTables(ctx context.Context, db *sql.DB) error {
	required := []string{
		"app_users", "app_actions", "app_user_auth",
		"app_managed_tables", "app_operation_history", "app_connections",
	}
	schema := appdb.Schema()
	for _, t := range required {
		var n int
		err := db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2`, schema, t).Scan(&n)
		if err != nil {
			return fmt.Errorf("store: verify app tables: %w", err)
		}
		if n == 0 {
			return fmt.Errorf("store: required table %s.%s not found (run deploy/initdb/01_init.sql with APP_SCHEMA=%s)", schema, t, schema)
		}
	}
	return nil
}
