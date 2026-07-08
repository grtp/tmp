package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type ManagedTable struct {
	ID          int
	SchemaName  string
	TableName   string
	DisplayName string
	Description string
	PKColumns   string // 登録時スナップショット(CSV)
	SortOrder   int
	Enabled     bool
	CreatedBy   string
}

func (r *Repo) ListManagedTables(ctx context.Context, includeDisabled bool) ([]ManagedTable, error) {
	q := `
		SELECT id, schema_name, table_name, display_name, COALESCE(description, N''),
		       pk_columns, sort_order, enabled, created_by
		FROM dbo.app_managed_tables`
	if !includeDisabled {
		q += ` WHERE enabled = 1`
	}
	q += ` ORDER BY sort_order, id`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("admin: list managed tables: %w", err)
	}
	defer rows.Close()

	out := []ManagedTable{}
	for rows.Next() {
		var m ManagedTable
		if err := rows.Scan(&m.ID, &m.SchemaName, &m.TableName, &m.DisplayName,
			&m.Description, &m.PKColumns, &m.SortOrder, &m.Enabled, &m.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) GetManagedTable(ctx context.Context, id int) (*ManagedTable, error) {
	var m ManagedTable
	err := r.db.QueryRowContext(ctx, `
		SELECT id, schema_name, table_name, display_name, COALESCE(description, N''),
		       pk_columns, sort_order, enabled, created_by
		FROM dbo.app_managed_tables WHERE id = @p1`, id).
		Scan(&m.ID, &m.SchemaName, &m.TableName, &m.DisplayName,
			&m.Description, &m.PKColumns, &m.SortOrder, &m.Enabled, &m.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("admin: get managed table: %w", err)
	}
	return &m, nil
}

// CreateManagedTable inserts a registration row. schema/table は呼び出し側
// (httpapi)がイントロスペクションで実在確認したカタログ上の正確な名前を
// 渡すこと。
func (r *Repo) CreateManagedTable(ctx context.Context, m ManagedTable) (*ManagedTable, error) {
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO dbo.app_managed_tables
			(schema_name, table_name, display_name, description, pk_columns, sort_order, created_by)
		OUTPUT INSERTED.id
		VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7)`,
		m.SchemaName, m.TableName, m.DisplayName, nullIfEmpty(m.Description),
		m.PKColumns, m.SortOrder, m.CreatedBy).Scan(&m.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: %s.%s は既に登録されています", ErrConflict, m.SchemaName, m.TableName)
		}
		return nil, fmt.Errorf("admin: create managed table: %w", err)
	}
	m.Enabled = true
	return &m, nil
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
