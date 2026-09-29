package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"

	"f-tool/internal/appdb"
)

type TxGuard func(ctx context.Context, tx *sql.Tx) error

type Group struct {
	ID          int
	Name        string
	Description string
	MemberCount int
	CreatedBy   string
	UpdatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Auth []UserAuthEntry
}

type GroupMember struct {
	Subject  Subject
	Name     string
	Username string
}

const groupSelect = `
SELECT g.id, g.name, COALESCE(g.description, N''),
       (SELECT COUNT(*) FROM dbo.ftool_app_group_members m WHERE m.group_id = g.id),
       g.created_by, g.updated_by, g.created_at, g.updated_at
FROM dbo.ftool_app_groups g`

func scanGroup(sc interface{ Scan(dest ...any) error }) (Group, error) {
	var g Group
	err := sc.Scan(&g.ID, &g.Name, &g.Description, &g.MemberCount,
		&g.CreatedBy, &g.UpdatedBy, &g.CreatedAt, &g.UpdatedAt)
	g.Auth = []UserAuthEntry{}
	return g, err
}

func (r *Repo) ListGroups(ctx context.Context) ([]Group, error) {
	rows, err := r.query(ctx, groupSelect+` ORDER BY g.name, g.id`)
	if err != nil {
		return nil, fmt.Errorf("repo: list groups: %w", err)
	}
	defer rows.Close()

	out := []Group{}
	index := map[int]int{}
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, err
		}
		index[g.ID] = len(out)
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	arows, err := r.query(ctx, `
SELECT ga.group_id, ga.action_id, a.code, ga.auth_level
FROM dbo.ftool_app_group_auth ga
JOIN dbo.ftool_app_actions a ON a.id = ga.action_id
ORDER BY a.sort_order, a.id`)
	if err != nil {
		return nil, fmt.Errorf("repo: list group auth: %w", err)
	}
	defer arows.Close()
	for arows.Next() {
		var gid, actionID int
		var code, level string
		if err := arows.Scan(&gid, &actionID, &code, &level); err != nil {
			return nil, err
		}
		if i, ok := index[gid]; ok {
			out[i].Auth = append(out[i].Auth, UserAuthEntry{
				ActionID: actionID, ActionCode: code, AuthLevel: authz.Level(level),
			})
		}
	}
	return out, arows.Err()
}

func (r *Repo) GetGroup(ctx context.Context, id int) (*Group, error) {
	g, err := scanGroup(r.queryRow(ctx, groupSelect+` WHERE g.id = @p1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("repo: get group: %w", err)
	}
	rows, err := r.query(ctx, `
SELECT ga.action_id, a.code, ga.auth_level
FROM dbo.ftool_app_group_auth ga
JOIN dbo.ftool_app_actions a ON a.id = ga.action_id
WHERE ga.group_id = @p1
ORDER BY a.sort_order, a.id`, id)
	if err != nil {
		return nil, fmt.Errorf("repo: get group auth: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var e UserAuthEntry
		var level string
		if err := rows.Scan(&e.ActionID, &e.ActionCode, &level); err != nil {
			return nil, err
		}
		e.AuthLevel = authz.Level(level)
		g.Auth = append(g.Auth, e)
	}
	return &g, rows.Err()
}

func (r *Repo) CreateGroup(ctx context.Context, name, description, actor string) (*Group, error) {
	var id int
	err := r.queryRow(ctx, `
INSERT INTO dbo.ftool_app_groups (name, description, created_by, updated_by)
OUTPUT INSERTED.id
VALUES (@p1, @p2, @p3, @p3)`, name, nullIfEmpty(description), actor).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: グループ名 %s は既に使用されています", ErrConflict, name)
		}
		return nil, fmt.Errorf("repo: create group: %w", err)
	}
	return r.GetGroup(ctx, id)
}

func (r *Repo) UpdateGroup(ctx context.Context, id int, name, description *string, actor string) (*Group, error) {
	var b setBuilder
	if name != nil {
		b.add("name", *name)
	}
	if description != nil {
		b.add("description", nullIfEmpty(*description))
	}
	if b.empty() {
		return r.GetGroup(ctx, id)
	}
	b.add("updated_by", actor)
	q := fmt.Sprintf(`UPDATE dbo.ftool_app_groups SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		b.clause(), b.arg(id))
	res, err := r.exec(ctx, q, b.args...)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: グループ名 %s は既に使用されています", ErrConflict, *name)
		}
		return nil, fmt.Errorf("repo: update group: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.GetGroup(ctx, id)
}

func (r *Repo) DeleteGroup(ctx context.Context, id int, guard TxGuard) error {
	return r.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			appdb.Q(`DELETE FROM dbo.ftool_app_group_members WHERE member_group_id = @p1`), id); err != nil {
			return fmt.Errorf("repo: clear group parents: %w", err)
		}
		res, err := tx.ExecContext(ctx, appdb.Q(`DELETE FROM dbo.ftool_app_groups WHERE id = @p1`), id)
		if err != nil {
			return fmt.Errorf("repo: delete group: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return runGuard(ctx, tx, guard)
	})
}

func (r *Repo) ListGroupMembers(ctx context.Context, id int) ([]GroupMember, error) {
	if _, err := r.GetGroup(ctx, id); err != nil {
		return nil, err
	}
	rows, err := r.query(ctx, `
SELECT LOWER(CONVERT(NVARCHAR(36), m.object_guid)), m.member_group_id,
       COALESCE(u.username, N''), COALESCE(u.display_name, g.name, N'')
FROM dbo.ftool_app_group_members m
LEFT JOIN dbo.ftool_app_users u ON u.object_guid = m.object_guid
LEFT JOIN dbo.ftool_app_groups g ON g.id = m.member_group_id
WHERE m.group_id = @p1
ORDER BY CASE WHEN m.member_group_id IS NULL THEN 1 ELSE 0 END, g.name, u.username`, id)
	if err != nil {
		return nil, fmt.Errorf("repo: list group members: %w", err)
	}
	defer rows.Close()

	out := []GroupMember{}
	for rows.Next() {
		var m GroupMember
		var guid sql.NullString
		var gid sql.NullInt64
		if err := rows.Scan(&guid, &gid, &m.Username, &m.Name); err != nil {
			return nil, err
		}
		if gid.Valid {
			m.Subject = Subject{Kind: SubjectGroup, GroupID: int(gid.Int64)}
		} else {
			m.Subject = Subject{Kind: SubjectUser, ObjectGUID: adguid.GUID(guid.String)}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func memberColumn(m Subject) string {
	if m.Kind == SubjectGroup {
		return "member_group_id"
	}
	return "object_guid"
}

func (r *Repo) AddGroupMember(ctx context.Context, id int, m Subject, actor string) error {
	return r.inTx(ctx, func(tx *sql.Tx) error {
		if m.Kind == SubjectGroup {
			if m.GroupID == id {
				return fmt.Errorf("%w: グループ自身を所属させることはできません", ErrConflict)
			}
			cyclic, err := isAncestor(ctx, tx, m.GroupID, id)
			if err != nil {
				return err
			}
			if cyclic {
				return fmt.Errorf("%w: 循環する所属になるため追加できません", ErrConflict)
			}
		}
		col := memberColumn(m)
		_, err := tx.ExecContext(ctx, appdb.Q(`
INSERT INTO dbo.ftool_app_group_members (group_id, `+col+`, created_by)
SELECT @p1, `+m.castExpr("@p2")+`, @p3
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.ftool_app_group_members
    WHERE group_id = @p1 AND `+col+` = `+m.castExpr("@p2")+`)`),
			id, m.arg(), actor)
		if err != nil {
			if isForeignKeyViolation(err) {
				return ErrNotFound
			}
			return fmt.Errorf("repo: add group member: %w", err)
		}
		return nil
	})
}

func isAncestor(ctx context.Context, tx *sql.Tx, candidate, target int) (bool, error) {
	const q = `
WITH anc (group_id, depth) AS (
    SELECT group_id, 0 FROM dbo.ftool_app_group_members WHERE member_group_id = @p1
    UNION ALL
    SELECT m.group_id, anc.depth + 1
    FROM dbo.ftool_app_group_members m
    JOIN anc ON m.member_group_id = anc.group_id
    WHERE anc.depth < 32
)
SELECT COUNT(*) FROM anc WHERE group_id = @p2`
	var n int
	if err := tx.QueryRowContext(ctx, appdb.Q(q), target, candidate).Scan(&n); err != nil {
		return false, fmt.Errorf("repo: ancestor check: %w", err)
	}
	return n > 0, nil
}

func (r *Repo) RemoveGroupMember(ctx context.Context, id int, m Subject, guard TxGuard) error {
	return r.inTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, appdb.Q(`
DELETE FROM dbo.ftool_app_group_members WHERE group_id = @p1 AND `+memberColumn(m)+` = `+m.castExpr("@p2")),
			id, m.arg())
		if err != nil {
			return fmt.Errorf("repo: remove group member: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return runGuard(ctx, tx, guard)
	})
}

func (r *Repo) ReplaceGroupAuth(ctx context.Context, id int, assignments []AuthAssignment, actor string, guard TxGuard) error {
	if _, err := r.GetGroup(ctx, id); err != nil {
		return err
	}
	return r.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			appdb.Q(`DELETE FROM dbo.ftool_app_group_auth WHERE group_id = @p1`), id); err != nil {
			return fmt.Errorf("repo: clear group auth: %w", err)
		}
		for _, a := range assignments {
			if !a.AuthLevel.Valid() {
				return fmt.Errorf("%w: auth_level %q が不正です", ErrConflict, a.AuthLevel)
			}
			if _, err := tx.ExecContext(ctx, appdb.Q(`
INSERT INTO dbo.ftool_app_group_auth (group_id, action_id, auth_level, created_by, updated_by)
VALUES (@p1, @p2, @p3, @p4, @p4)`),
				id, a.ActionID, string(a.AuthLevel), actor); err != nil {
				return fmt.Errorf("repo: insert group auth (action %d): %w", a.ActionID, err)
			}
		}
		return runGuard(ctx, tx, guard)
	})
}

func runGuard(ctx context.Context, tx *sql.Tx, guard TxGuard) error {
	if guard == nil {
		return nil
	}
	return guard(ctx, tx)
}

func (r *Repo) inTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("repo: begin: %w", err)
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
