// Package authz resolves per-action authorization levels from the
// app_users / app_actions / app_user_auth tables, keyed by AD objectGUID.
//
// 旧版のグローバル role 1本から、機能(action)ごとの auth_level へ拡張した。
// 行が無い機能は「権限なし」。レベルは admin > maintainer > user。
package authz

import (
	"context"
	"database/sql"
	"fmt"

	"tablemaint/internal/auth"
	"tablemaint/internal/auth/adguid"
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

// Covers reports whether l satisfies the minimum required level.
func (l Level) Covers(min Level) bool { return rank[l] >= rank[min] }

// Grant is one (action, level) pair the user holds.
type Grant struct {
	ActionID int
	Code     string
	Name     string
	Icon     string
	Level    Level
}

// Grants maps action code -> grant. enabled な機能のみ含まれる。
type Grants struct {
	// Ordered は app_actions.sort_order 順(ダッシュボード描画用)。
	Ordered []Grant
	byCode  map[string]Grant
}

// Level returns the level for an action code ("" if not granted).
func (g *Grants) Level(code string) (Level, bool) {
	gr, ok := g.byCode[code]
	return gr.Level, ok
}

// Allows reports whether the user holds at least min on the action.
func (g *Grants) Allows(code string, min Level) bool {
	gr, ok := g.byCode[code]
	return ok && gr.Level.Covers(min)
}

// 組込 action code。フロントのルーティングおよび認可チェックと対応する。
const (
	ActionTableMaint = "table-maint"
	ActionSettings   = "settings"
	// ActionAuth は履歴記録用の擬似 code(app_actions には存在しない)。
	ActionAuth = "auth"
)

type Resolver struct {
	db *sql.DB
	// 初回ログイン時に table-maint:user を自動付与するか。
	AutoGrantTableMaintView bool
}

func NewResolver(db *sql.DB, autoGrant bool) *Resolver {
	return &Resolver{db: db, AutoGrantTableMaintView: autoGrant}
}

// EnsureUser upserts the user row by objectGUID.
//
// MATCHED 側で権限に触れないのが要点: 管理者が付与した権限をログインの
// たびにリセットする事故を防ぐ。username/display_name/email は AD 改名に
// 追従するため毎回最新化する(照合には一切使わない)。
func (r *Resolver) EnsureUser(ctx context.Context, id *auth.Identity) error {
	const q = `
MERGE dbo.app_users WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET username = @p2, display_name = @p3, email = @p4,
               last_login_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, email, last_login_at)
    VALUES (@p1, @p2, @p3, @p4, SYSUTCDATETIME())
OUTPUT $action;`

	var action string
	err := r.db.QueryRowContext(ctx, q,
		string(id.ObjectGUID), id.Username, id.DisplayName, nullIfEmpty(id.Email),
	).Scan(&action)
	if err != nil {
		return fmt.Errorf("authz: ensure user: %w", err)
	}

	if action == "INSERT" && r.AutoGrantTableMaintView {
		// 初回ログイン: table-maint の閲覧権限を自動付与し、
		// 「ログインできたのに何も見えない」状態を避ける。
		const grant = `
INSERT INTO dbo.app_user_auth (object_guid, action_id, auth_level, updated_by)
SELECT CAST(@p1 AS UNIQUEIDENTIFIER), a.id, N'user', N'system:auto-register'
FROM dbo.app_actions a
WHERE a.code = @p2
  AND NOT EXISTS (
      SELECT 1 FROM dbo.app_user_auth ua
      WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND ua.action_id = a.id)`
		if _, err := r.db.ExecContext(ctx, grant, string(id.ObjectGUID), ActionTableMaint); err != nil {
			return fmt.Errorf("authz: auto grant: %w", err)
		}
	}
	return nil
}

// Grants loads the user's per-action levels (enabled actions only).
// 毎リクエスト呼ばれる想定(PK ルックアップ1回)。セッションにキャッシュ
// しないことで権限変更が即時反映される。
func (r *Resolver) Grants(ctx context.Context, guid adguid.GUID) (*Grants, error) {
	const q = `
SELECT a.id, a.code, a.name, a.icon, ua.auth_level
FROM dbo.app_user_auth ua
JOIN dbo.app_actions a ON a.id = ua.action_id
WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND a.enabled = 1
ORDER BY a.sort_order, a.id`

	rows, err := r.db.QueryContext(ctx, q, string(guid))
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
