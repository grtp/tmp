package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"tablemaint/internal/auth/adguid"
)

// UserLink はユーザー個人のダッシュボードリンクカード。
// 全操作が本人の object_guid でスコープされる(他人の行には触れない)。
type UserLink struct {
	ID        int
	Name      string
	URL       string
	Icon      string
	SortOrder int
}

func (r *Repo) ListUserLinks(ctx context.Context, guid adguid.GUID) ([]UserLink, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, url, icon, sort_order
		FROM dbo.app_user_links
		WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
		ORDER BY sort_order, id`, string(guid))
	if err != nil {
		return nil, fmt.Errorf("admin: list user links: %w", err)
	}
	defer rows.Close()

	out := []UserLink{}
	for rows.Next() {
		var l UserLink
		if err := rows.Scan(&l.ID, &l.Name, &l.URL, &l.Icon, &l.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *Repo) GetUserLink(ctx context.Context, guid adguid.GUID, id int) (*UserLink, error) {
	var l UserLink
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, url, icon, sort_order
		FROM dbo.app_user_links
		WHERE id = @p1 AND object_guid = CAST(@p2 AS UNIQUEIDENTIFIER)`,
		id, string(guid)).
		Scan(&l.ID, &l.Name, &l.URL, &l.Icon, &l.SortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound // 存在しない or 他人のリンク(区別しない)
	}
	if err != nil {
		return nil, fmt.Errorf("admin: get user link: %w", err)
	}
	return &l, nil
}

func (r *Repo) CreateUserLink(ctx context.Context, guid adguid.GUID, l UserLink) (*UserLink, error) {
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO dbo.app_user_links (object_guid, name, url, icon, sort_order)
		OUTPUT INSERTED.id
		VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5)`,
		string(guid), l.Name, l.URL, l.Icon, l.SortOrder).Scan(&l.ID)
	if err != nil {
		return nil, fmt.Errorf("admin: create user link: %w", err)
	}
	return &l, nil
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
	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: update user link: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetUserLink(ctx, guid, id)
}

func (r *Repo) DeleteUserLink(ctx context.Context, guid adguid.GUID, id int) error {
	res, err := r.db.ExecContext(ctx, `
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
