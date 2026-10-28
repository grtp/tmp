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
	ID int

	Name        string
	DisplayName string
	Description string

	Rank        *int
	MemberCount int
	CreatedBy   string
	UpdatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Auth []UserAuthEntry
}

type GroupMember struct {
	Subject   Subject
	Name      string
	Username  string
	GroupName string
}

const groupSelect = `
SELECT g.id, g.name, g.display_name, COALESCE(g.description, N''), g.[rank],
       (SELECT COUNT(*) FROM dbo.ftool_app_group_members m WHERE m.group_id = g.id),
       g.created_by, g.updated_by, g.created_at, g.updated_at
FROM dbo.ftool_app_groups g`

func scanGroup(sc interface{ Scan(dest ...any) error }) (Group, error) {
	var g Group
	var rank sql.NullInt64
	err := sc.Scan(&g.ID, &g.Name, &g.DisplayName, &g.Description, &rank, &g.MemberCount,
		&g.CreatedBy, &g.UpdatedBy, &g.CreatedAt, &g.UpdatedAt)
	if rank.Valid {
		v := int(rank.Int64)
		g.Rank = &v
	}
	g.Auth = []UserAuthEntry{}
	return g, err
}

func (r *Repo) ListGroups(ctx context.Context) ([]Group, error) {
	rows, err := r.query(ctx, groupSelect+` ORDER BY g.display_name, g.name, g.id`)
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

func (r *Repo) CreateGroup(ctx context.Context, name, displayName, description string, rank *int, actor string) (*Group, error) {
	var id int
	err := r.queryRow(ctx, `
INSERT INTO dbo.ftool_app_groups (name, display_name, description, [rank], created_by, updated_by)
OUTPUT INSERTED.id
VALUES (@p1, @p2, @p3, @p4, @p5, @p5)`, name, displayName, nullIfEmpty(description), nullableInt(rank), actor).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: 管理用名 %s は既に使用されています", ErrConflict, name)
		}
		return nil, fmt.Errorf("repo: create group: %w", err)
	}
	return r.GetGroup(ctx, id)
}

type OptionalRank struct {
	Set   bool
	Value *int
}

func (r *Repo) UpdateGroup(ctx context.Context, id int, name, displayName, description *string, rank OptionalRank, actor string) (*Group, error) {
	var b setBuilder
	if name != nil {
		b.add("name", *name)
	}
	if displayName != nil {
		b.add("display_name", *displayName)
	}
	if description != nil {
		b.add("description", nullIfEmpty(*description))
	}
	if rank.Set {
		b.add("[rank]", nullableInt(rank.Value))
	}
	if b.empty() {
		return r.GetGroup(ctx, id)
	}
	b.add("updated_by", actor)
	q := fmt.Sprintf(`UPDATE dbo.ftool_app_groups SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		b.clause(), b.arg(id))
	err := r.inTx(ctx, func(tx *sql.Tx) error {
		if rank.Set && rank.Value != nil {
			if err := checkRankOrder(ctx, tx, id, *rank.Value); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, appdb.Q(q), b.args...)
		if err != nil {
			if isUniqueViolation(err) && name != nil {
				return fmt.Errorf("%w: 管理用名 %s は既に使用されています", ErrConflict, *name)
			}
			return fmt.Errorf("repo: update group: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetGroup(ctx, id)
}

func nullableInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

type rankedGroup struct {
	ID   int
	Name string
	Rank int
}

func rankBoundAbove(ctx context.Context, tx *sql.Tx, start int, includeSelf bool) (*rankedGroup, error) {
	const q = `
WITH anc (group_id, depth) AS (
    SELECT CAST(@p1 AS INT), 0
    UNION ALL
    SELECT m.group_id, anc.depth + 1
    FROM dbo.ftool_app_group_members m
    JOIN anc ON m.member_group_id = anc.group_id
    WHERE anc.depth < 32
)
SELECT TOP 1 g.id, g.display_name, g.[rank]
FROM anc
JOIN dbo.ftool_app_groups g ON g.id = anc.group_id
WHERE g.[rank] IS NOT NULL AND (anc.depth > 0 OR @p2 = 1)
ORDER BY g.[rank] DESC, g.id`
	return scanRanked(tx.QueryRowContext(ctx, appdb.Q(q), start, boolArg(includeSelf)))
}

func rankBoundBelow(ctx context.Context, tx *sql.Tx, start int, includeSelf bool) (*rankedGroup, error) {
	const q = `
WITH des (group_id, depth) AS (
    SELECT CAST(@p1 AS INT), 0
    UNION ALL
    SELECT m.member_group_id, des.depth + 1
    FROM dbo.ftool_app_group_members m
    JOIN des ON m.group_id = des.group_id
    WHERE m.member_group_id IS NOT NULL AND des.depth < 32
)
SELECT TOP 1 g.id, g.display_name, g.[rank]
FROM des
JOIN dbo.ftool_app_groups g ON g.id = des.group_id
WHERE g.[rank] IS NOT NULL AND (des.depth > 0 OR @p2 = 1)
ORDER BY g.[rank] ASC, g.id`
	return scanRanked(tx.QueryRowContext(ctx, appdb.Q(q), start, boolArg(includeSelf)))
}

func scanRanked(row *sql.Row) (*rankedGroup, error) {
	var g rankedGroup
	err := row.Scan(&g.ID, &g.Name, &g.Rank)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("repo: rank bound: %w", err)
	}
	return &g, nil
}

func boolArg(b bool) int {
	if b {
		return 1
	}
	return 0
}

func checkRankOrder(ctx context.Context, tx *sql.Tx, id, rank int) error {
	above, err := rankBoundAbove(ctx, tx, id, false)
	if err != nil {
		return err
	}
	if above != nil && above.Rank >= rank {
		return fmt.Errorf("%w: 上位の %s (rank %d) より大きいランクを指定してください", ErrConflict, above.Name, above.Rank)
	}
	below, err := rankBoundBelow(ctx, tx, id, false)
	if err != nil {
		return err
	}
	if below != nil && below.Rank <= rank {
		return fmt.Errorf("%w: 下位の %s (rank %d) より小さいランクを指定してください", ErrConflict, below.Name, below.Rank)
	}
	return nil
}

func checkRankOrderForEdge(ctx context.Context, tx *sql.Tx, parent, child int) error {
	above, err := rankBoundAbove(ctx, tx, parent, true)
	if err != nil {
		return err
	}
	if above == nil {
		return nil
	}
	below, err := rankBoundBelow(ctx, tx, child, true)
	if err != nil {
		return err
	}
	if below != nil && above.Rank >= below.Rank {
		return fmt.Errorf("%w: ランクの順序に反するため追加できません(上位の %s (rank %d) が下位の %s (rank %d) 以上)",
			ErrConflict, above.Name, above.Rank, below.Name, below.Rank)
	}
	return nil
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
       COALESCE(u.username, N''), COALESCE(u.display_name, g.display_name, N''), COALESCE(g.name, N'')
FROM dbo.ftool_app_group_members m
LEFT JOIN dbo.ftool_app_users u ON u.object_guid = m.object_guid
LEFT JOIN dbo.ftool_app_groups g ON g.id = m.member_group_id
WHERE m.group_id = @p1
ORDER BY CASE WHEN m.member_group_id IS NULL THEN 1 ELSE 0 END, g.display_name, u.username`, id)
	if err != nil {
		return nil, fmt.Errorf("repo: list group members: %w", err)
	}
	defer rows.Close()

	out := []GroupMember{}
	for rows.Next() {
		var m GroupMember
		var guid sql.NullString
		var gid sql.NullInt64
		if err := rows.Scan(&guid, &gid, &m.Username, &m.Name, &m.GroupName); err != nil {
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

type GroupEdge struct {
	GroupID int
	GroupMember
}

func (r *Repo) ListAllGroupMembers(ctx context.Context) ([]GroupEdge, error) {
	rows, err := r.query(ctx, `
SELECT m.group_id, LOWER(CONVERT(NVARCHAR(36), m.object_guid)), m.member_group_id,
       COALESCE(u.username, N''), COALESCE(u.display_name, g.display_name, N''), COALESCE(g.name, N'')
FROM dbo.ftool_app_group_members m
LEFT JOIN dbo.ftool_app_users u ON u.object_guid = m.object_guid
LEFT JOIN dbo.ftool_app_groups g ON g.id = m.member_group_id
ORDER BY m.group_id, CASE WHEN m.member_group_id IS NULL THEN 1 ELSE 0 END, g.display_name, u.username`)
	if err != nil {
		return nil, fmt.Errorf("repo: list all group members: %w", err)
	}
	defer rows.Close()

	out := []GroupEdge{}
	for rows.Next() {
		var e GroupEdge
		var guid sql.NullString
		var gid sql.NullInt64
		if err := rows.Scan(&e.GroupID, &guid, &gid, &e.Username, &e.Name, &e.GroupName); err != nil {
			return nil, err
		}
		if gid.Valid {
			e.Subject = Subject{Kind: SubjectGroup, GroupID: int(gid.Int64)}
		} else {
			e.Subject = Subject{Kind: SubjectUser, ObjectGUID: adguid.GUID(guid.String)}
		}
		out = append(out, e)
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
			if err := checkRankOrderForEdge(ctx, tx, id, m.GroupID); err != nil {
				return err
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
