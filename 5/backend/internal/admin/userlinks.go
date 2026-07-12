package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"tablemaint/internal/auth/adguid"
)

// UserLink はユーザー個人のダッシュボードカード。
// kind='link' は任意 URL、kind='table' は管理対象テーブルへのショートカット、
// kind='action' は機能へのショートカット。
// 全操作が本人の object_guid でスコープされる(他人の行には触れない)。
type UserLink struct {
	ID   int
	Kind string // "link" | "table" | "action"
	Name string
	URL  string // kind=link のみ
	// ManagedTableID / ManagedTableName: kind=table のみ(0/"" = なし)。
	ManagedTableID   int
	ManagedTableName string
	// ActionID / ActionCode: kind=action のみ(0/"" = なし)。
	ActionID   int
	ActionCode string
	Icon       string
	SortOrder  int
}

const userLinkCols = `
	l.id, l.kind, l.name, COALESCE(l.url, N''),
	COALESCE(l.managed_table_id, 0), COALESCE(m.display_name, N''),
	COALESCE(l.action_id, 0), COALESCE(a.code, N''),
	l.icon, l.sort_order`

const userLinkFrom = `
	FROM dbo.app_user_links l
	LEFT JOIN dbo.app_managed_tables m ON m.id = l.managed_table_id
	LEFT JOIN dbo.app_actions a ON a.id = l.action_id`

func scanUserLink(row interface{ Scan(...any) error }) (*UserLink, error) {
	var l UserLink
	err := row.Scan(&l.ID, &l.Kind, &l.Name, &l.URL,
		&l.ManagedTableID, &l.ManagedTableName,
		&l.ActionID, &l.ActionCode, &l.Icon, &l.SortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound // 存在しない or 他人のリンク(区別しない)
	}
	if err != nil {
		return nil, fmt.Errorf("admin: scan user link: %w", err)
	}
	return &l, nil
}

func (r *Repo) ListUserLinks(ctx context.Context, guid adguid.GUID) ([]UserLink, error) {
	rows, err := r.query(ctx,
		`SELECT`+userLinkCols+userLinkFrom+`
		WHERE l.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
		ORDER BY l.sort_order, l.id`, string(guid))
	if err != nil {
		return nil, fmt.Errorf("admin: list user links: %w", err)
	}
	defer rows.Close()

	out := []UserLink{}
	for rows.Next() {
		l, err := scanUserLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

func (r *Repo) GetUserLink(ctx context.Context, guid adguid.GUID, id int) (*UserLink, error) {
	return scanUserLink(r.queryRow(ctx,
		`SELECT`+userLinkCols+userLinkFrom+`
		WHERE l.id = @p1 AND l.object_guid = CAST(@p2 AS UNIQUEIDENTIFIER)`,
		id, string(guid)))
}

func (r *Repo) CreateUserLink(ctx context.Context, guid adguid.GUID, l UserLink) (*UserLink, error) {
	var url, tableID, actionID any
	switch l.Kind {
	case "table":
		tableID = l.ManagedTableID
	case "action":
		actionID = l.ActionID
	default:
		url = l.URL
	}
	err := r.queryRow(ctx, `
		INSERT INTO dbo.app_user_links (object_guid, kind, name, url, managed_table_id, action_id, icon, sort_order)
		OUTPUT INSERTED.id
		VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5, @p6, @p7, @p8)`,
		string(guid), l.Kind, l.Name, url, tableID, actionID, l.Icon, l.SortOrder).Scan(&l.ID)
	if err != nil {
		return nil, fmt.Errorf("admin: create user link: %w", err)
	}
	return r.GetUserLink(ctx, guid, l.ID)
}

func (r *Repo) UpdateUserLink(ctx context.Context, guid adguid.GUID, id int, name, url, icon *string, sortOrder *int) (*UserLink, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if name != nil {
		add("name", *name)
	}
	if url != nil {
		add("url", *url)
	}
	if icon != nil {
		add("icon", *icon)
	}
	if sortOrder != nil {
		add("sort_order", *sortOrder)
	}
	if len(sets) == 0 {
		return r.GetUserLink(ctx, guid, id)
	}
	args = append(args, id, string(guid))

	q := fmt.Sprintf(`
		UPDATE dbo.app_user_links SET %s, updated_at = SYSUTCDATETIME()
		WHERE id = @p%d AND object_guid = CAST(@p%d AS UNIQUEIDENTIFIER)`,
		strings.Join(sets, ", "), len(args)-1, len(args))
	res, err := r.exec(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: update user link: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetUserLink(ctx, guid, id)
}

func (r *Repo) DeleteUserLink(ctx context.Context, guid adguid.GUID, id int) error {
	res, err := r.exec(ctx, `
		DELETE FROM dbo.app_user_links
		WHERE id = @p1 AND object_guid = CAST(@p2 AS UNIQUEIDENTIFIER)`,
		id, string(guid))
	if err != nil {
		return fmt.Errorf("admin: delete user link: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
