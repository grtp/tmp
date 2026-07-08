// Package admin owns CRUD over the tool's own app_* tables:
// actions (機能マスタ), managed tables (管理対象登録), users+auth, history.
package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ErrNotFound / ErrConflict は httpapi が 404 / 409 に写像する。
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Action struct {
	ID        int
	Code      string
	Name      string
	Icon      string
	SortOrder int
	Enabled   bool
	IsBuiltin bool
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

// ------------------------------------------------------------- actions

func (r *Repo) ListActions(ctx context.Context) ([]Action, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, code, name, icon, sort_order, enabled, is_builtin
		FROM dbo.app_actions ORDER BY sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("admin: list actions: %w", err)
	}
	defer rows.Close()

	out := []Action{}
	for rows.Next() {
		var a Action
		if err := rows.Scan(&a.ID, &a.Code, &a.Name, &a.Icon, &a.SortOrder, &a.Enabled, &a.IsBuiltin); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repo) GetAction(ctx context.Context, id int) (*Action, error) {
	var a Action
	err := r.db.QueryRowContext(ctx, `
		SELECT id, code, name, icon, sort_order, enabled, is_builtin
		FROM dbo.app_actions WHERE id = @p1`, id).
		Scan(&a.ID, &a.Code, &a.Name, &a.Icon, &a.SortOrder, &a.Enabled, &a.IsBuiltin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("admin: get action: %w", err)
	}
	return &a, nil
}

func (r *Repo) CreateAction(ctx context.Context, a Action) (*Action, error) {
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO dbo.app_actions (code, name, icon, sort_order, enabled, is_builtin)
		OUTPUT INSERTED.id
		VALUES (@p1, @p2, @p3, @p4, @p5, 0)`,
		a.Code, a.Name, a.Icon, a.SortOrder, a.Enabled).Scan(&a.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: code %q は既に存在します", ErrConflict, a.Code)
		}
		return nil, fmt.Errorf("admin: create action: %w", err)
	}
	a.IsBuiltin = false
	return &a, nil
}

// UpdateAction applies a partial update. nil フィールドは変更しない。
func (r *Repo) UpdateAction(ctx context.Context, id int, name, icon *string, sortOrder *int, enabled *bool) (*Action, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if name != nil {
		add("name", *name)
	}
	if icon != nil {
		add("icon", *icon)
	}
	if sortOrder != nil {
		add("sort_order", *sortOrder)
	}
	if enabled != nil {
		add("enabled", *enabled)
	}
	if len(sets) == 0 {
		return r.GetAction(ctx, id)
	}
	args = append(args, id)

	q := fmt.Sprintf(`UPDATE dbo.app_actions SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		strings.Join(sets, ", "), len(args))
	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: update action: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetAction(ctx, id)
}

func (r *Repo) DeleteAction(ctx context.Context, id int) error {
	a, err := r.GetAction(ctx, id)
	if err != nil {
		return err
	}
	if a.IsBuiltin {
		return fmt.Errorf("%w: 組込機能 %q は削除できません", ErrConflict, a.Code)
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM dbo.app_actions WHERE id = @p1`, id); err != nil {
		return fmt.Errorf("admin: delete action: %w", err)
	}
	return nil
}

// isUniqueViolation: mssql エラー 2601/2627 (unique index / constraint)。
// ドライバの型に依存せずメッセージで判定する(表示専用の分類のため)。
func isUniqueViolation(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "2627") || strings.Contains(msg, "2601") ||
		strings.Contains(msg, "duplicate key") || strings.Contains(msg, "UNIQUE")
}
