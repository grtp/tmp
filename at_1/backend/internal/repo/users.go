package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"
	"f-tool/internal/predicate"

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

type ListUsersParams struct {
	Preds  []predicate.Predicate
	Limit  int
	Offset int
}

type UsersPage struct {
	Users  []UserWithAuth
	Total  int
	Limit  int
	Offset int
}

func usersPredSpecs() map[string]predicate.ColumnSpec {
	return map[string]predicate.ColumnSpec{
		"username":    {SQL: "username", Type: predicate.TypeString},
		"displayName": {SQL: "display_name", Type: predicate.TypeString},
		"email":       {SQL: "email", Type: predicate.TypeString, Nullable: true},

		"lastLoginAt": {SQL: "last_login_at", Type: predicate.TypeDateTime,
			Nullable: true, DayOffsetMinutes: 540},
	}
}

var actionCodeRe = regexp.MustCompile(`^[a-z0-9-]+$`)

func authPredSpec(code string) predicate.ColumnSpec {
	return predicate.ColumnSpec{
		SQL: fmt.Sprintf(
			`(SELECT ua.auth_level FROM dbo.ftool_app_user_auth ua`+
				` JOIN dbo.ftool_app_actions a ON a.id = ua.action_id`+
				` WHERE ua.object_guid = dbo.ftool_app_users.object_guid AND a.code = N'%s')`,
			code),
		Type:     predicate.TypeEnum,
		Nullable: true,
		Enum:     []string{"user", "maintainer", "admin"},
	}
}

func (r *Repo) listActionCodes(ctx context.Context) ([]string, error) {
	rows, err := r.query(ctx, `SELECT code FROM dbo.ftool_app_actions`)
	if err != nil {
		return nil, fmt.Errorf("repo: list action codes: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repo) ListUsers(ctx context.Context, p ListUsersParams) (*UsersPage, error) {
	var b whereBuilder
	if len(p.Preds) > 0 {
		specs := usersPredSpecs()

		codes, err := r.listActionCodes(ctx)
		if err != nil {
			return nil, err
		}
		for _, c := range codes {
			if actionCodeRe.MatchString(c) {
				specs["auth:"+c] = authPredSpec(c)
			}
		}
		conds, args, err := predicate.Build(specs, p.Preds, len(b.args))
		if err != nil {
			return nil, err
		}
		b.conds = append(b.conds, conds...)
		b.args = append(b.args, args...)
	}
	where, args := b.where()

	var total int
	if err := r.queryRow(ctx,
		"SELECT COUNT(*) FROM dbo.ftool_app_users"+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("repo: users count: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT LOWER(CONVERT(NVARCHAR(36), object_guid)), username, display_name,
		       COALESCE(email, N''), last_login_at
		FROM dbo.ftool_app_users%s
		ORDER BY username, object_guid
		OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY`, where, len(args)+1, len(args)+2)
	args = append(args, p.Offset, p.Limit)

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
	page := &UsersPage{Users: users, Total: total, Limit: p.Limit, Offset: p.Offset}
	if len(users) == 0 {
		return page, nil
	}

	authArgs := make([]any, 0, len(users))
	ph := make([]string, 0, len(users))
	for _, u := range users {
		authArgs = append(authArgs, string(u.ObjectGUID))
		ph = append(ph, fmt.Sprintf("CAST(@p%d AS UNIQUEIDENTIFIER)", len(authArgs)))
	}
	arows, err := r.query(ctx, fmt.Sprintf(`
		SELECT LOWER(CONVERT(NVARCHAR(36), ua.object_guid)), ua.action_id, a.code, ua.auth_level
		FROM dbo.ftool_app_user_auth ua
		JOIN dbo.ftool_app_actions a ON a.id = ua.action_id
		WHERE ua.object_guid IN (%s)
		ORDER BY a.sort_order, a.id`, strings.Join(ph, ", ")), authArgs...)
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
	return page, arows.Err()
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

func (r *Repo) ReplaceUserAuth(ctx context.Context, guid adguid.GUID, assignments []AuthAssignment, updatedBy string) error {

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

		if _, err := tx.ExecContext(ctx, appdb.Q(`
			INSERT INTO dbo.ftool_app_user_auth (object_guid, action_id, auth_level, created_by, updated_by)
			VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p4)`),
			string(guid), a.ActionID, string(a.AuthLevel), updatedBy); err != nil {

			return fmt.Errorf("repo: insert auth (action %d): %w", a.ActionID, err)
		}
	}
	return tx.Commit()
}
