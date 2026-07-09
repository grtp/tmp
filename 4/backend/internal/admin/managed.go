package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"tablemaint/internal/meta"
)

type ManagedTable struct {
	ID int
	// ConnectionID: nil = 既定接続(アプリ自身の DB)。
	ConnectionID *int
	// ConnectionName: 接続の表示名(既定接続は "")。
	ConnectionName string
	SchemaName     string
	TableName      string
	DisplayName    string
	Description    string
	PKColumns      string // 登録時スナップショット(CSV)
	SortOrder      int
	Enabled        bool
	CreatedBy      string
}

const managedCols = `
	m.id, m.connection_id, COALESCE(c.name, N''), m.schema_name, m.table_name,
	m.display_name, COALESCE(m.description, N''), m.pk_columns, m.sort_order,
	m.enabled, m.created_by`

const managedFrom = `
	FROM dbo.app_managed_tables m
	LEFT JOIN dbo.app_connections c ON c.id = m.connection_id`

func scanManaged(row interface{ Scan(...any) error }) (*ManagedTable, error) {
	var m ManagedTable
	var connID sql.NullInt64
	err := row.Scan(&m.ID, &connID, &m.ConnectionName, &m.SchemaName, &m.TableName,
		&m.DisplayName, &m.Description, &m.PKColumns, &m.SortOrder, &m.Enabled, &m.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("admin: scan managed table: %w", err)
	}
	if connID.Valid {
		v := int(connID.Int64)
		m.ConnectionID = &v
	}
	return &m, nil
}

func (r *Repo) ListManagedTables(ctx context.Context, includeDisabled bool) ([]ManagedTable, error) {
	q := `SELECT` + managedCols + managedFrom
	if !includeDisabled {
		q += ` WHERE m.enabled = 1`
	}
	q += ` ORDER BY m.sort_order, m.id`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("admin: list managed tables: %w", err)
	}
	defer rows.Close()

	out := []ManagedTable{}
	for rows.Next() {
		m, err := scanManaged(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func (r *Repo) GetManagedTable(ctx context.Context, id int) (*ManagedTable, error) {
	return scanManaged(r.db.QueryRowContext(ctx,
		`SELECT`+managedCols+managedFrom+` WHERE m.id = @p1`, id))
}

// ListRegisteredNames returns the schema.table set already registered in a
// connection scope (nil = 既定接続)。meta.ListCandidates の除外セット用。
func (r *Repo) ListRegisteredNames(ctx context.Context, connID *int) (map[string]struct{}, error) {
	const q = `
		SELECT schema_name, table_name FROM dbo.app_managed_tables
		WHERE (@p1 IS NULL AND connection_id IS NULL) OR connection_id = @p1`

	var arg any
	if connID != nil {
		arg = *connID
	}
	rows, err := r.db.QueryContext(ctx, q, arg)
	if err != nil {
		return nil, fmt.Errorf("admin: list registered names: %w", err)
	}
	defer rows.Close()

	out := map[string]struct{}{}
	for rows.Next() {
		var schema, table string
		if err := rows.Scan(&schema, &table); err != nil {
			return nil, err
		}
		out[meta.RegisteredKey(schema, table)] = struct{}{}
	}
	return out, rows.Err()
}

// CreateManagedTable inserts a registration row. schema/table は呼び出し側
// (httpapi)がイントロスペクションで実在確認したカタログ上の正確な名前を
// 渡すこと。
func (r *Repo) CreateManagedTable(ctx context.Context, m ManagedTable) (*ManagedTable, error) {
	var connArg any
	if m.ConnectionID != nil {
		connArg = *m.ConnectionID
	}
	var id int
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO dbo.app_managed_tables
			(connection_id, schema_name, table_name, display_name, description, pk_columns, sort_order, created_by)
		OUTPUT INSERTED.id
		VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`,
		connArg, m.SchemaName, m.TableName, m.DisplayName, nullIfEmpty(m.Description),
		m.PKColumns, m.SortOrder, m.CreatedBy).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: %s.%s は既に登録されています", ErrConflict, m.SchemaName, m.TableName)
		}
		return nil, fmt.Errorf("admin: create managed table: %w", err)
	}
	return r.GetManagedTable(ctx, id)
}

func (r *Repo) UpdateManagedTable(ctx context.Context, id int, displayName, description *string, sortOrder *int, enabled *bool) (*ManagedTable, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if displayName != nil {
		add("display_name", *displayName)
	}
	if description != nil {
		add("description", nullIfEmpty(*description))
	}
	if sortOrder != nil {
		add("sort_order", *sortOrder)
	}
	if enabled != nil {
		add("enabled", *enabled)
	}
	if len(sets) == 0 {
		return r.GetManagedTable(ctx, id)
	}
	args = append(args, id)

	q := fmt.Sprintf(`UPDATE dbo.app_managed_tables SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		strings.Join(sets, ", "), len(args))
	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: update managed table: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetManagedTable(ctx, id)
}

func (r *Repo) DeleteManagedTable(ctx context.Context, id int) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM dbo.app_managed_tables WHERE id = @p1`, id)
	if err != nil {
		return fmt.Errorf("admin: delete managed table: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
