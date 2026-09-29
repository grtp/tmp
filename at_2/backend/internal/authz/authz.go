package authz

import (
	"context"
	"database/sql"
	"fmt"

	"f-tool/internal/auth"
	"f-tool/internal/auth/adguid"

	"f-tool/internal/appdb"
)

type Level string

const (
	LevelAdmin      Level = "admin"
	LevelMaintainer Level = "maintainer"
	LevelUser       Level = "user"
)

func (l Level) Valid() bool {
	return l == LevelAdmin || l == LevelMaintainer || l == LevelUser
}

var rank = map[Level]int{LevelUser: 1, LevelMaintainer: 2, LevelAdmin: 3}

func (l Level) Covers(min Level) bool { return rank[l] >= rank[min] }

type Grant struct {
	ActionID int
	Code     string
	Name     string
	Icon     string
	Level    Level
}

type Grants struct {
	Ordered []Grant
	byCode  map[string]Grant
}

func (g *Grants) Level(code string) (Level, bool) {
	gr, ok := g.byCode[code]
	return gr.Level, ok
}

func (g *Grants) Allows(code string, min Level) bool {
	gr, ok := g.byCode[code]
	return ok && gr.Level.Covers(min)
}

const (
	ActionTables   = "tables"
	ActionSettings = "settings"

	ActionHistory = "history"

	ActionAuth = "auth"
)

type Resolver struct {
	db *sql.DB

	AutoGrantTablesView bool
}

func NewResolver(db *sql.DB, autoGrant bool) *Resolver {
	return &Resolver{db: db, AutoGrantTablesView: autoGrant}
}

func (r *Resolver) EnsureUser(ctx context.Context, id *auth.Identity) error {

	const q = `
MERGE dbo.ftool_app_users WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET username = @p2, display_name = @p3, email = @p4,
               department = @p5, title = @p6,
               last_login_at = SYSUTCDATETIME(), updated_by = @p2, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, email, department, title, last_login_at, created_by, updated_by)
    VALUES (@p1, @p2, @p3, @p4, @p5, @p6, SYSUTCDATETIME(), @p2, @p2)
OUTPUT $action;`

	var action string
	err := r.db.QueryRowContext(ctx, appdb.Q(q),
		string(id.ObjectGUID), id.Username, id.DisplayName, nullIfEmpty(id.Email),
		nullIfEmpty(id.Department), nullIfEmpty(id.Title),
	).Scan(&action)
	if err != nil {
		return fmt.Errorf("authz: ensure user: %w", err)
	}

	if err := r.syncGroups(ctx, id.ObjectGUID, id.MemberOf); err != nil {
		return fmt.Errorf("authz: sync groups: %w", err)
	}

	if action == "INSERT" && r.AutoGrantTablesView {

		const grant = `
INSERT INTO dbo.ftool_app_user_auth (object_guid, action_id, auth_level, created_by, updated_by)
SELECT CAST(@p1 AS UNIQUEIDENTIFIER), a.id, N'user', N'system:auto-register', N'system:auto-register'
FROM dbo.ftool_app_actions a
WHERE a.code = @p2
  AND NOT EXISTS (
      SELECT 1 FROM dbo.ftool_app_user_auth ua
      WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND ua.action_id = a.id)`
		if _, err := r.db.ExecContext(ctx, appdb.Q(grant), string(id.ObjectGUID), ActionTables); err != nil {
			return fmt.Errorf("authz: auto grant: %w", err)
		}
	}

	return nil
}

func (r *Resolver) syncGroups(ctx context.Context, guid adguid.GUID, memberOf []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		appdb.Q(`DELETE FROM dbo.ftool_app_user_groups WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`),
		string(guid)); err != nil {
		return fmt.Errorf("clear groups: %w", err)
	}
	for _, dn := range memberOf {
		if dn == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, appdb.Q(`
INSERT INTO dbo.ftool_app_user_groups (object_guid, group_dn) VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2)`),
			string(guid), dn); err != nil {
			return fmt.Errorf("insert group: %w", err)
		}
	}
	return tx.Commit()
}

func (r *Resolver) Grants(ctx context.Context, guid adguid.GUID, groupIDs []int) (*Grants, error) {
	return r.grantsOn(ctx, r.db, guid, groupIDs)
}

func (r *Resolver) grantsOn(ctx context.Context, q Querier, guid adguid.GUID, groupIDs []int) (*Grants, error) {
	args := []any{string(guid)}
	src := `SELECT action_id, auth_level FROM dbo.ftool_app_user_auth WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`
	if len(groupIDs) > 0 {
		ph, extra := inPlaceholders(len(args)+1, groupIDs)
		args = append(args, extra...)
		src += `
UNION ALL
SELECT action_id, auth_level FROM dbo.ftool_app_group_auth WHERE group_id IN (` + ph + `)`
	}
	query := `
SELECT a.id, a.code, a.name, a.icon, x.auth_level
FROM (` + src + `) x
JOIN dbo.ftool_app_actions a ON a.id = x.action_id
WHERE a.enabled = 1
ORDER BY a.sort_order, a.id`

	rows, err := q.QueryContext(ctx, appdb.Q(query), args...)
	if err != nil {
		return nil, fmt.Errorf("authz: grants: %w", err)
	}
	defer rows.Close()

	out := &Grants{byCode: map[string]Grant{}}
	for rows.Next() {
		var g Grant
		var level string
		if err := rows.Scan(&g.ActionID, &g.Code, &g.Name, &g.Icon, &level); err != nil {
			return nil, fmt.Errorf("authz: scan: %w", err)
		}
		g.Level = Level(level)
		if !g.Level.Valid() {
			return nil, fmt.Errorf("authz: unexpected auth_level %q", level)
		}

		if cur, ok := out.byCode[g.Code]; ok {
			if g.Level.Covers(cur.Level) {
				out.byCode[g.Code] = g
				for i := range out.Ordered {
					if out.Ordered[i].Code == g.Code {
						out.Ordered[i] = g
					}
				}
			}
			continue
		}
		out.Ordered = append(out.Ordered, g)
		out.byCode[g.Code] = g
	}
	return out, rows.Err()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
