package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"

	"f-tool/internal/appdb"
)

type UserAuthEntry struct {
	ActionID   int
	ActionCode string
	AuthLevel  authz.Level
}

type UserWithAuth struct {
	ObjectGUID  adguid.GUID
	Username    string
	DisplayName string
	Email       string
	LastLoginAt *time.Time
	Auth        []UserAuthEntry
}

type AuthAssignment struct {
	ActionID  int
	AuthLevel authz.Level
}

// ListUsers は全ユーザーを機能別レベル付きで返す
// (q = username/display_name の部分一致)。
func (r *Repo) ListUsers(ctx context.Context, q string) ([]UserWithAuth, error) {
	query := `
		SELECT LOWER(CONVERT(NVARCHAR(36), object_guid)), username, display_name,
		       COALESCE(email, N''), last_login_at
		FROM dbo.ftool_app_users`
	var args []any
	if q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		query += ` WHERE username LIKE @p1 ESCAPE '\' OR display_name LIKE @p1 ESCAPE '\'`
	}
	query += ` ORDER BY username`

	rows, err := r.query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("repo: list users: %w", err)
	}
	defer rows.Close()

	users := []UserWithAuth{}
	index := map[adguid.GUID]int{}
	for rows.Next() {
		var u UserWithAuth
		var guid string
		var last sql.NullTime
		if err := rows.Scan(&guid, &u.Username, &u.DisplayName, &u.Email, &last); err != nil {
			return nil, err
		}
		u.ObjectGUID = adguid.GUID(guid)
		if last.Valid {
			t := last.Time
			u.LastLoginAt = &t
		}
		u.Auth = []UserAuthEntry{}
		index[u.ObjectGUID] = len(users)
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 権限は一括で引いてメモリで突き合わせる(N+1 回避)。
	arows, err := r.query(ctx, `
		SELECT LOWER(CONVERT(NVARCHAR(36), ua.object_guid)), ua.action_id, a.code, ua.auth_level
		FROM dbo.ftool_app_user_auth ua
		JOIN dbo.ftool_app_actions a ON a.id = ua.action_id
		ORDER BY a.sort_order, a.id`)
	if err != nil {
		return nil, fmt.Errorf("repo: list user auth: %w", err)
	}
	defer arows.Close()
	for arows.Next() {
		var guid, code, level string
		var actionID int
		if err := arows.Scan(&guid, &actionID, &code, &level); err != nil {
			return nil, err
		}
		if i, ok := index[adguid.GUID(guid)]; ok {
			users[i].Auth = append(users[i].Auth, UserAuthEntry{
				ActionID: actionID, ActionCode: code, AuthLevel: authz.Level(level),
			})
		}
	}
	return users, arows.Err()
}

func (r *Repo) GetUser(ctx context.Context, guid adguid.GUID) (*UserWithAuth, error) {
	var u UserWithAuth
	var g string
	var last sql.NullTime
	err := r.queryRow(ctx, `
		SELECT LOWER(CONVERT(NVARCHAR(36), object_guid)), username, display_name,
		       COALESCE(email, N''), last_login_at
		FROM dbo.ftool_app_users WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`, string(guid)).
		Scan(&g, &u.Username, &u.DisplayName, &u.Email, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("repo: get user: %w", err)
	}
	u.ObjectGUID = adguid.GUID(g)
	if last.Valid {
		t := last.Time
		u.LastLoginAt = &t
	}

	rows, err := r.query(ctx, `
		SELECT ua.action_id, a.code, ua.auth_level
		FROM dbo.ftool_app_user_auth ua
		JOIN dbo.ftool_app_actions a ON a.id = ua.action_id
		WHERE ua.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
		ORDER BY a.sort_order, a.id`, string(guid))
	if err != nil {
		return nil, fmt.Errorf("repo: get user auth: %w", err)
	}
	defer rows.Close()
	u.Auth = []UserAuthEntry{}
	for rows.Next() {
		var e UserAuthEntry
		var level string
		if err := rows.Scan(&e.ActionID, &e.ActionCode, &level); err != nil {
			return nil, err
		}
		e.AuthLevel = authz.Level(level)
		u.Auth = append(u.Auth, e)
	}
	return &u, rows.Err()
}

// ReplaceUserAuth はユーザーの全権限を単一トランザクションで置換する
// (DELETE + INSERT)。含まれない機能 = 権限なし。
func (r *Repo) ReplaceUserAuth(ctx context.Context, guid adguid.GUID, assignments []AuthAssignment, updatedBy string) error {
	// 実在チェック(存在しない GUID への付与は 404)
	if _, err := r.GetUser(ctx, guid); err != nil {
		return err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("repo: begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		appdb.Q(`DELETE FROM dbo.ftool_app_user_auth WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`),
		string(guid)); err != nil {
		return fmt.Errorf("repo: clear auth: %w", err)
	}
	for _, a := range assignments {
		if !a.AuthLevel.Valid() {
			return fmt.Errorf("%w: auth_level %q が不正です", ErrConflict, a.AuthLevel)
		}
		// DELETE+INSERT の全置換なので，このリクエストの度に行が新規作成
		// される = created_by も updated_by も同じ actor(updatedBy)でよい。
		if _, err := tx.ExecContext(ctx, appdb.Q(`
			INSERT INTO dbo.ftool_app_user_auth (object_guid, action_id, auth_level, created_by, updated_by)
			VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p4)`),
			string(guid), a.ActionID, string(a.AuthLevel), updatedBy); err != nil {
			// FK 違反 = 存在しない action_id
			return fmt.Errorf("repo: insert auth (action %d): %w", a.ActionID, err)
		}
	}
	return tx.Commit()
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`, `[`, `\[`)

func escapeLike(s string) string { return likeEscaper.Replace(s) }
