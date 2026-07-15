package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"f-tool/internal/appdb"
)

// DashTemplate はダッシュボードテンプレート。
// OwnerGUID = "" は admin 配布(全員が選択可)、非空は個人テンプレート
// (所有者本人しか参照・変更・削除できない)。
type DashTemplate struct {
	ID          int
	OwnerGUID   string // "" = 配布 / 非空 = 個人(所有者の objectGUID)
	Name        string
	Description string
	Enabled     bool
	CreatedBy   string
	Items       []DashTemplateItem // 詳細取得時のみ
}

// DashTemplateItem はテンプレートの1カード。
//   - kind=action: ActionID/ActionCode が対象機能を指す(表示は機能側の定義)
//   - kind=link  : Name/URL/Icon をこの行自身が持つ
type DashTemplateItem struct {
	ID         int
	Position   int
	Kind       string // "action" | "link" | "table"
	ActionID   int    // kind=action のみ(0 = なし)
	ActionCode string // kind=action のみ(表示解決用)
	// ManagedTableID / ManagedTableName: kind=table のみ(0/"" = なし)。
	// Name は表示解決用に管理対象テーブルの display_name を返す。
	ManagedTableID   int
	ManagedTableName string
	Name             string
	URL              string
	Icon             string
}

// ListDashTemplates は閲覧者に見えるテンプレートを返す。
// includeDisabled=true は admin の管理画面用で配布テンプレートのみ
// (個人テンプレートは管理対象外)。通常は enabled な配布 + 本人の個人を
// 配布→個人、名前順で返す。
func (r *Repo) ListDashTemplates(ctx context.Context, includeDisabled bool, viewerGUID string) ([]DashTemplate, error) {
	q := `
		SELECT id, COALESCE(CONVERT(NVARCHAR(36), owner_guid), N''),
		       name, COALESCE(description, N''), enabled, created_by
		FROM dbo.app_dash_templates`
	var args []any
	if includeDisabled {
		q += ` WHERE owner_guid IS NULL`
	} else {
		q += ` WHERE enabled = 1
			AND (owner_guid IS NULL OR owner_guid = CAST(@p1 AS UNIQUEIDENTIFIER))`
		args = append(args, viewerGUID)
	}
	q += ` ORDER BY CASE WHEN owner_guid IS NULL THEN 0 ELSE 1 END, name`

	rows, err := r.query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: list dash templates: %w", err)
	}
	defer rows.Close()

	out := []DashTemplate{}
	for rows.Next() {
		var t DashTemplate
		if err := rows.Scan(&t.ID, &t.OwnerGUID, &t.Name, &t.Description, &t.Enabled, &t.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetDashTemplate returns the template with its items (position 順)。
// viewerGUID: 他人の個人テンプレートは存在しない扱い(ErrNotFound)。
func (r *Repo) GetDashTemplate(ctx context.Context, id int, viewerGUID string) (*DashTemplate, error) {
	var t DashTemplate
	err := r.queryRow(ctx, `
		SELECT id, COALESCE(CONVERT(NVARCHAR(36), owner_guid), N''),
		       name, COALESCE(description, N''), enabled, created_by
		FROM dbo.app_dash_templates
		WHERE id = @p1
		  AND (owner_guid IS NULL OR owner_guid = CAST(@p2 AS UNIQUEIDENTIFIER))`,
		id, viewerGUID).
		Scan(&t.ID, &t.OwnerGUID, &t.Name, &t.Description, &t.Enabled, &t.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("admin: get dash template: %w", err)
	}

	rows, err := r.query(ctx, `
		SELECT i.id, i.position, i.kind,
		       COALESCE(i.action_id, 0), COALESCE(a.code, N''),
		       COALESCE(i.managed_table_id, 0), COALESCE(m.display_name, N''),
		       COALESCE(i.name, N''), COALESCE(i.url, N''), COALESCE(i.icon, N'')
		FROM dbo.app_dash_template_items i
		LEFT JOIN dbo.app_actions a ON a.id = i.action_id
		LEFT JOIN dbo.app_managed_tables m ON m.id = i.managed_table_id
		WHERE i.template_id = @p1
		ORDER BY i.position, i.id`, id)
	if err != nil {
		return nil, fmt.Errorf("admin: get dash template items: %w", err)
	}
	defer rows.Close()

	t.Items = []DashTemplateItem{}
	for rows.Next() {
		var it DashTemplateItem
		if err := rows.Scan(&it.ID, &it.Position, &it.Kind, &it.ActionID, &it.ActionCode,
			&it.ManagedTableID, &it.ManagedTableName,
			&it.Name, &it.URL, &it.Icon); err != nil {
			return nil, err
		}
		t.Items = append(t.Items, it)
	}
	return &t, rows.Err()
}

func (r *Repo) CreateDashTemplate(ctx context.Context, t DashTemplate) (*DashTemplate, error) {
	var owner any
	if t.OwnerGUID != "" {
		owner = t.OwnerGUID
	}
	var id int
	err := r.queryRow(ctx, `
		INSERT INTO dbo.app_dash_templates (owner_guid, name, description, enabled, created_by)
		OUTPUT INSERTED.id
		VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5)`,
		owner, t.Name, nullIfEmpty(t.Description), t.Enabled, t.CreatedBy).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: テンプレート名 %q は既に存在します", ErrConflict, t.Name)
		}
		return nil, fmt.Errorf("admin: create dash template: %w", err)
	}
	return r.GetDashTemplate(ctx, id, t.OwnerGUID)
}

func (r *Repo) UpdateDashTemplate(ctx context.Context, id int, name, description *string, enabled *bool, viewerGUID string) (*DashTemplate, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if name != nil {
		add("name", *name)
	}
	if description != nil {
		add("description", nullIfEmpty(*description))
	}
	if enabled != nil {
		add("enabled", *enabled)
	}
	if len(sets) == 0 {
		return r.GetDashTemplate(ctx, id, viewerGUID)
	}
	args = append(args, id)

	q := fmt.Sprintf(`UPDATE dbo.app_dash_templates SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		strings.Join(sets, ", "), len(args))
	res, err := r.exec(ctx, q, args...)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: テンプレート名が重複しています", ErrConflict)
		}
		return nil, fmt.Errorf("admin: update dash template: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetDashTemplate(ctx, id, viewerGUID)
}

func (r *Repo) DeleteDashTemplate(ctx context.Context, id int) error {
	// items は CASCADE、app_user_dash.template_id は SET NULL(既定に戻る)。
	res, err := r.exec(ctx, `DELETE FROM dbo.app_dash_templates WHERE id = @p1`, id)
	if err != nil {
		return fmt.Errorf("admin: delete dash template: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReplaceDashTemplateItems は項目を一括置換する(配列順 = position)。
func (r *Repo) ReplaceDashTemplateItems(ctx context.Context, templateID int, items []DashTemplateItem, viewerGUID string) (*DashTemplate, error) {
	// テンプレートの実在確認(無ければ 404)。
	if _, err := r.GetDashTemplate(ctx, templateID, viewerGUID); err != nil {
		return nil, err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("admin: begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		appdb.Q(`DELETE FROM dbo.app_dash_template_items WHERE template_id = @p1`), templateID); err != nil {
		return nil, fmt.Errorf("admin: clear items: %w", err)
	}
	for pos, it := range items {
		var actionID, tableID any
		if it.Kind == "action" {
			actionID = it.ActionID
		}
		if it.Kind == "table" {
			tableID = it.ManagedTableID
		}
		if _, err := tx.ExecContext(ctx, appdb.Q(`
			INSERT INTO dbo.app_dash_template_items
				(template_id, position, kind, action_id, managed_table_id, name, url, icon)
			VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`),
			templateID, pos, it.Kind, actionID, tableID,
			nullIfEmpty(it.Name), nullIfEmpty(it.URL), nullIfEmpty(it.Icon)); err != nil {
			// FK 違反 = 存在しない action_id / managed_table_id
			return nil, fmt.Errorf("admin: insert item %d: %w", pos, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("admin: commit: %w", err)
	}
	return r.GetDashTemplate(ctx, templateID, viewerGUID)
}
