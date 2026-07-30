package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"f-tool/internal/meta"
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
	// ReadonlyColumns / HiddenColumns: 列モード指定(CSV)。
	// readonly = 表示のみ,hidden = SELECT 自体から除外(個人情報の遮断用)。
	ReadonlyColumns string
	HiddenColumns   string
	// FixedColumns: 固定値列の指定(JSON 配列。'[]' = なし)。
	// 解釈は meta.ParseFixedColumns が行う。
	FixedColumns string
	SortOrder    int
	Enabled      bool
	CreatedBy    string
}

const managedCols = `
	m.id, m.connection_id, COALESCE(c.name, N''), m.schema_name, m.table_name,
	m.display_name, COALESCE(m.description, N''), m.pk_columns,
	m.readonly_columns, m.hidden_columns, m.fixed_columns, m.sort_order,
	m.enabled, m.created_by`

const managedFrom = `
	FROM dbo.ftool_app_managed_tables m
	LEFT JOIN dbo.ftool_app_connections c ON c.id = m.connection_id`

func scanManaged(row interface{ Scan(...any) error }) (*ManagedTable, error) {
	var m ManagedTable
	var connID sql.NullInt64
	err := row.Scan(&m.ID, &connID, &m.ConnectionName, &m.SchemaName, &m.TableName,
		&m.DisplayName, &m.Description, &m.PKColumns,
		&m.ReadonlyColumns, &m.HiddenColumns, &m.FixedColumns, &m.SortOrder, &m.Enabled, &m.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("repo: scan managed table: %w", err)
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

	rows, err := r.query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("repo: list managed tables: %w", err)
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
	return scanManaged(r.queryRow(ctx,
		`SELECT`+managedCols+managedFrom+` WHERE m.id = @p1`, id))
}

// ListRegisteredNames は登録済みの schema.table 集合を返す
// (接続スコープ単位,nil = 既定接続)。meta.ListCandidates の除外セット用。
func (r *Repo) ListRegisteredNames(ctx context.Context, connID *int) (map[string]struct{}, error) {
	const q = `
		SELECT schema_name, table_name FROM dbo.ftool_app_managed_tables
		WHERE (@p1 IS NULL AND connection_id IS NULL) OR connection_id = @p1`

	var arg any
	if connID != nil {
		arg = *connID
	}
	rows, err := r.query(ctx, q, arg)
	if err != nil {
		return nil, fmt.Errorf("repo: list registered names: %w", err)
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
	fixed := m.FixedColumns
	if fixed == "" {
		fixed = "[]"
	}
	var id int
	err := r.queryRow(ctx, `
		INSERT INTO dbo.ftool_app_managed_tables
			(connection_id, schema_name, table_name, display_name, description, pk_columns,
			 readonly_columns, hidden_columns, fixed_columns, sort_order, created_by, updated_by)
		OUTPUT INSERTED.id
		VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p11)`,
		connArg, m.SchemaName, m.TableName, m.DisplayName, nullIfEmpty(m.Description),
		m.PKColumns, m.ReadonlyColumns, m.HiddenColumns, fixed, m.SortOrder, m.CreatedBy).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: %s.%s は既に登録されています", ErrConflict, m.SchemaName, m.TableName)
		}
		return nil, fmt.Errorf("repo: create managed table: %w", err)
	}
	return r.GetManagedTable(ctx, id)
}

func (r *Repo) UpdateManagedTable(ctx context.Context, id int, displayName, description *string, sortOrder *int, enabled *bool, readonlyColumns, hiddenColumns, fixedColumns *string, updatedBy string) (*ManagedTable, error) {
	var b setBuilder
	if displayName != nil {
		b.add("display_name", *displayName)
	}
	if description != nil {
		b.add("description", nullIfEmpty(*description))
	}
	if sortOrder != nil {
		b.add("sort_order", *sortOrder)
	}
	if enabled != nil {
		b.add("enabled", *enabled)
	}
	if readonlyColumns != nil {
		b.add("readonly_columns", *readonlyColumns)
	}
	if hiddenColumns != nil {
		b.add("hidden_columns", *hiddenColumns)
	}
	if fixedColumns != nil {
		b.add("fixed_columns", *fixedColumns)
	}
	if b.empty() {
		return r.GetManagedTable(ctx, id)
	}
	b.add("updated_by", updatedBy)

	q := fmt.Sprintf(`UPDATE dbo.ftool_app_managed_tables SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		b.clause(), b.arg(id))
	res, err := r.exec(ctx, q, b.args...)
	if err != nil {
		return nil, fmt.Errorf("repo: update managed table: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetManagedTable(ctx, id)
}

func (r *Repo) DeleteManagedTable(ctx context.Context, id int) error {
	res, err := r.exec(ctx, `DELETE FROM dbo.ftool_app_managed_tables WHERE id = @p1`, id)
	if err != nil {
		return fmt.Errorf("repo: delete managed table: %w", err)
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
