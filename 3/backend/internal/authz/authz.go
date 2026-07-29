// Package authz は機能(action)ごとの認可レベルを解決する。参照先は
// ftool_app_users / ftool_app_actions / ftool_app_user_auth，キーは AD objectGUID。
//
// 旧版のグローバル role 1本から，機能(action)ごとの auth_level へ拡張した。
// 行が無い機能は「権限なし」。レベルは admin > maintainer > user。
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

// Covers は l が要求最低レベル min を満たすかを返す。
func (l Level) Covers(min Level) bool { return rank[l] >= rank[min] }

type Grant struct {
	ActionID int
	Code     string
	Name     string
	Icon     string
	Level    Level
}

// Grants は action code → grant の索引。enabled な機能のみ含まれる。
type Grants struct {
	// Ordered は ftool_app_actions.sort_order 順(ダッシュボード描画用)。
	Ordered []Grant
	byCode  map[string]Grant
}

// Level は action code の付与レベルを返す(未付与は "")。
func (g *Grants) Level(code string) (Level, bool) {
	gr, ok := g.byCode[code]
	return gr.Level, ok
}

// Allows はその機能に min 以上の権限を持つかを返す。
func (g *Grants) Allows(code string, min Level) bool {
	gr, ok := g.byCode[code]
	return ok && gr.Level.Covers(min)
}

// Built-in action codes(フロントのルーティングおよび認可チェックと対応)。
const (
	ActionTableMaint = "table-maint"
	ActionSettings   = "settings"
	// ActionHistory: 操作履歴の閲覧権限(maintainer 以上で閲覧可)。
	ActionHistory = "history"
	// ActionAuth は履歴記録用の擬似 code(ftool_app_actions には存在しない)。
	ActionAuth = "auth"
)

type Resolver struct {
	db *sql.DB
	// 初回ログイン時に table-maint:user を自動付与するか。
	AutoGrantTableMaintView bool
}

// NewResolver returns a Resolver. autoGrant は初回ログイン時の
// table-maint:user 自動付与の有効/無効(config.AutoGrantTableMaintView)。
func NewResolver(db *sql.DB, autoGrant bool) *Resolver {
	return &Resolver{db: db, AutoGrantTableMaintView: autoGrant}
}

// EnsureUser は objectGUID をキーにユーザー行を upsert する。
//
// MATCHED 側で権限に触れないのが要点: 管理者が付与した権限をログインの
// たびにリセットする事故を防ぐ。username/display_name/email は AD 改名に
// 追従するため毎回最新化する(照合には一切使わない)。
func (r *Resolver) EnsureUser(ctx context.Context, id *auth.Identity) error {
	// created_by/updated_by は自己登録(本人の LDAP ログイン)なので本人の
	// username をそのまま入れる(管理者による代理登録が無いため)。
	const q = `
MERGE dbo.ftool_app_users WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET username = @p2, display_name = @p3, email = @p4,
               last_login_at = SYSUTCDATETIME(), updated_by = @p2, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, email, last_login_at, created_by, updated_by)
    VALUES (@p1, @p2, @p3, @p4, SYSUTCDATETIME(), @p2, @p2)
OUTPUT $action;`

	var action string
	err := r.db.QueryRowContext(ctx, appdb.Q(q),
		string(id.ObjectGUID), id.Username, id.DisplayName, nullIfEmpty(id.Email),
	).Scan(&action)
	if err != nil {
		return fmt.Errorf("authz: ensure user: %w", err)
	}

	if action == "INSERT" && r.AutoGrantTableMaintView {
		// 初回ログイン: table-maint の閲覧権限を自動付与し，
		// 「ログインできたのに何も見えない」状態を避ける。
		const grant = `
INSERT INTO dbo.ftool_app_user_auth (object_guid, action_id, auth_level, created_by, updated_by)
SELECT CAST(@p1 AS UNIQUEIDENTIFIER), a.id, N'user', N'system:auto-register', N'system:auto-register'
FROM dbo.ftool_app_actions a
WHERE a.code = @p2
  AND NOT EXISTS (
      SELECT 1 FROM dbo.ftool_app_user_auth ua
      WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND ua.action_id = a.id)`
		if _, err := r.db.ExecContext(ctx, appdb.Q(grant), string(id.ObjectGUID), ActionTableMaint); err != nil {
			return fmt.Errorf("authz: auto grant: %w", err)
		}
	}

	if action == "INSERT" {
		// 初回ログインだけ既定構成(権限のある機能カード)を実体化する。
		// 2回目以降にやり直さないのが要点: ユーザーが自分で全カードを
		// 消した状態を「未設定」と誤認して勝手に復活させないため
		// (項目0件 = 空のまま表示，が dash-items の仕様)。
		if err := r.seedDefaultDashItems(ctx, id.ObjectGUID); err != nil {
			return err
		}
	}
	return nil
}

// sidebarOnlyActions はカードにしない機能(サイドバーからのみ開く)。
// フロント側の SIDEBAR_ONLY と同じ集合を保つ。
var sidebarOnlyActions = []string{ActionSettings, ActionHistory}

// seedDefaultDashItems は初回ログイン時のダッシュボードを作る。
// 「テンプレート > 既定」と同じ内容(権限のある有効な機能を sort_order 順)。
func (r *Resolver) seedDefaultDashItems(ctx context.Context, guid adguid.GUID) error {
	const q = `
INSERT INTO dbo.ftool_app_user_dash_items
    (object_guid, position, kind, action_id, icon, created_by, updated_by)
SELECT CAST(@p1 AS UNIQUEIDENTIFIER),
       ROW_NUMBER() OVER (ORDER BY a.sort_order, a.id),
       N'action', a.id, a.icon, N'system:first-login', N'system:first-login'
FROM dbo.ftool_app_actions a
JOIN dbo.ftool_app_user_auth ua
  ON ua.action_id = a.id AND ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
WHERE a.enabled = 1
  AND a.code NOT IN (@p2, @p3)`
	if _, err := r.db.ExecContext(ctx, appdb.Q(q), string(guid),
		sidebarOnlyActions[0], sidebarOnlyActions[1]); err != nil {
		return fmt.Errorf("authz: seed dash items: %w", err)
	}
	return nil
}

// Grants はユーザーの機能別レベルを読む(enabled な機能のみ)。
// 毎リクエスト呼ばれる想定(PK ルックアップ1回)。セッションにキャッシュ
// しないことで権限変更が即時反映される。
func (r *Resolver) Grants(ctx context.Context, guid adguid.GUID) (*Grants, error) {
	const q = `
SELECT a.id, a.code, a.name, a.icon, ua.auth_level
FROM dbo.ftool_app_user_auth ua
JOIN dbo.ftool_app_actions a ON a.id = ua.action_id
WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND a.enabled = 1
ORDER BY a.sort_order, a.id`

	rows, err := r.db.QueryContext(ctx, appdb.Q(q), string(guid))
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
