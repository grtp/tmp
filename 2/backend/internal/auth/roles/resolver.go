// Package roles resolves authorization (admin/maintainer/user) from the
// app_user_roles table keyed by AD objectGUID.
package roles

import (
	"context"
	"database/sql"
	"fmt"

	"tablemaint/internal/auth"
)

type Role string

const (
	RoleAdmin      Role = "admin"
	RoleMaintainer Role = "maintainer"
	RoleUser       Role = "user"
	// RoleGuest = 未認証。テーブルには存在せず API 上は 401 で表現される。
)

func (r Role) Valid() bool {
	return r == RoleAdmin || r == RoleMaintainer || r == RoleUser
}

// Resolver turns an authenticated identity into a role.
// EnsureUser is called once per login: first-timers are auto-registered
// as 'user'; existing users get their display attributes refreshed.
type Resolver interface {
	EnsureUser(ctx context.Context, id *auth.Identity) (Role, error)
}

// ---------------------------------------------------------------- MSSQL

type MSSQLResolver struct{ db *sql.DB }

func NewMSSQLResolver(db *sql.DB) *MSSQLResolver { return &MSSQLResolver{db: db} }

// EnsureUser upserts by objectGUID.
//
// MATCHED 側で role を更新しないのが要点: 管理者が昇格させたロールを
// ログインのたびに 'user' へ戻す事故を防ぐ。username/display_name は
// AD 改名に追従するため毎回最新化する(照合には一切使わない)。
func (r *MSSQLResolver) EnsureUser(ctx context.Context, id *auth.Identity) (Role, error) {
	const q = `
MERGE dbo.app_user_roles WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET username = @p2, display_name = @p3
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, role, updated_by)
    VALUES (@p1, @p2, @p3, 'user', 'system:auto-register')
OUTPUT inserted.role;`

	var role string
	err := r.db.QueryRowContext(ctx, q,
		string(id.ObjectGUID), id.Username, id.DisplayName,
	).Scan(&role)
	if err != nil {
		return "", fmt.Errorf("roles: ensure user: %w", err)
	}
	out := Role(role)
	if !out.Valid() {
		return "", fmt.Errorf("roles: unexpected role %q in database", role)
	}
	return out, nil
}

// ----------------------------------------------------------------- Mock

// MockResolver returns a fixed role without touching the database.
// Combine with auth.MockAuthenticator to test role-dependent behavior.
type MockResolver struct{ Role Role }

func (m *MockResolver) EnsureUser(context.Context, *auth.Identity) (Role, error) {
	if !m.Role.Valid() {
		return RoleUser, nil
	}
	return m.Role, nil
}
