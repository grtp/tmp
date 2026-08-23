package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

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
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) ListActions(ctx context.Context) ([]Action, error) {
	rows, err := r.query(ctx, `
		SELECT id, code, name, icon, sort_order, enabled
		FROM dbo.ftool_app_actions ORDER BY sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("repo: list actions: %w", err)
	}
	defer rows.Close()

	out := []Action{}
	for rows.Next() {
		var a Action
		if err := rows.Scan(&a.ID, &a.Code, &a.Name, &a.Icon, &a.SortOrder, &a.Enabled); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repo) GetAction(ctx context.Context, id int) (*Action, error) {
	var a Action
	err := r.queryRow(ctx, `
		SELECT id, code, name, icon, sort_order, enabled
		FROM dbo.ftool_app_actions WHERE id = @p1`, id).
		Scan(&a.ID, &a.Code, &a.Name, &a.Icon, &a.SortOrder, &a.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("repo: get action: %w", err)
	}
	return &a, nil
}

func (r *Repo) UpdateAction(ctx context.Context, id int, name, icon *string, sortOrder *int, enabled *bool, updatedBy string) (*Action, error) {
	var b setBuilder
	if name != nil {
		b.add("name", *name)
	}
	if icon != nil {
		b.add("icon", *icon)
	}
	if sortOrder != nil {
		b.add("sort_order", *sortOrder)
	}
	if enabled != nil {
		b.add("enabled", *enabled)
	}
	if b.empty() {
		return r.GetAction(ctx, id)
	}
	b.add("updated_by", updatedBy)

	q := fmt.Sprintf(`UPDATE dbo.ftool_app_actions SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		b.clause(), b.arg(id))
	res, err := r.exec(ctx, q, b.args...)
	if err != nil {
		return nil, fmt.Errorf("repo: update action: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetAction(ctx, id)
}

func isUniqueViolation(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "2627") || strings.Contains(msg, "2601") ||
		strings.Contains(msg, "duplicate key") || strings.Contains(msg, "UNIQUE")
}
