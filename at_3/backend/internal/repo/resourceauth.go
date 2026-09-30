package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"

	"f-tool/internal/appdb"
)

type SubjectKind string

const (
	SubjectUser  SubjectKind = "user"
	SubjectGroup SubjectKind = "group"
)

func (k SubjectKind) Valid() bool { return k == SubjectUser || k == SubjectGroup }

type Subject struct {
	Kind       SubjectKind
	ObjectGUID adguid.GUID
	GroupID    int
}

func (s Subject) column() string {
	if s.Kind == SubjectGroup {
		return "group_id"
	}
	return "object_guid"
}

func (s Subject) arg() any {
	if s.Kind == SubjectGroup {
		return s.GroupID
	}
	return string(s.ObjectGUID)
}

func (s Subject) castExpr(p string) string {
	if s.Kind == SubjectGroup {
		return p
	}
	return "CAST(" + p + " AS UNIQUEIDENTIFIER)"
}

type ResourceAuthEntry struct {
	Subject Subject

	Name string

	Username  string
	AuthLevel authz.ResourceLevel
}

const resourceAuthSelect = `
SELECT LOWER(CONVERT(NVARCHAR(36), ra.object_guid)), ra.group_id,
       COALESCE(u.username, N''), COALESCE(u.display_name, g.name, N''), ra.auth_level
FROM dbo.ftool_app_resource_auth ra
LEFT JOIN dbo.ftool_app_users u ON u.object_guid = ra.object_guid
LEFT JOIN dbo.ftool_app_groups g ON g.id = ra.group_id`

func scanResourceAuth(sc interface{ Scan(dest ...any) error }) (ResourceAuthEntry, error) {
	var e ResourceAuthEntry
	var guid sql.NullString
	var gid sql.NullInt64
	var level string
	if err := sc.Scan(&guid, &gid, &e.Username, &e.Name, &level); err != nil {
		return e, err
	}
	if gid.Valid {
		e.Subject = Subject{Kind: SubjectGroup, GroupID: int(gid.Int64)}
	} else {
		e.Subject = Subject{Kind: SubjectUser, ObjectGUID: adguid.GUID(guid.String)}
	}
	e.AuthLevel = authz.ResourceLevel(level)
	return e, nil
}

func (r *Repo) ListResourceAuth(ctx context.Context, rtype authz.ResourceType, rid int) ([]ResourceAuthEntry, error) {
	rows, err := r.query(ctx, resourceAuthSelect+`
WHERE ra.resource_type = @p1 AND ra.resource_id = @p2
ORDER BY CASE WHEN ra.group_id IS NULL THEN 1 ELSE 0 END, g.name, u.username`,
		string(rtype), rid)
	if err != nil {
		return nil, fmt.Errorf("repo: list resource auth: %w", err)
	}
	defer rows.Close()

	out := []ResourceAuthEntry{}
	for rows.Next() {
		e, err := scanResourceAuth(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repo) getResourceAuth(ctx context.Context, rtype authz.ResourceType, rid int, s Subject) (*ResourceAuthEntry, error) {
	row := r.queryRow(ctx, resourceAuthSelect+`
WHERE ra.resource_type = @p1 AND ra.resource_id = @p2 AND ra.`+s.column()+` = `+s.castExpr("@p3"),
		string(rtype), rid, s.arg())
	e, err := scanResourceAuth(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("repo: get resource auth: %w", err)
	}
	return &e, nil
}

func (r *Repo) SetResourceAuth(ctx context.Context, rtype authz.ResourceType, rid int, s Subject, level authz.ResourceLevel, actor string) (*ResourceAuthEntry, error) {
	col := s.column()
	_, err := r.exec(ctx, `
MERGE dbo.ftool_app_resource_auth WITH (HOLDLOCK) AS t
USING (SELECT @p1 AS resource_type, @p2 AS resource_id, `+s.castExpr("@p3")+` AS subject) AS src
ON t.resource_type = src.resource_type AND t.resource_id = src.resource_id AND t.`+col+` = src.subject
WHEN MATCHED THEN
    UPDATE SET auth_level = @p4, updated_by = @p5, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (resource_type, resource_id, `+col+`, auth_level, created_by, updated_by)
    VALUES (src.resource_type, src.resource_id, src.subject, @p4, @p5, @p5);`,
		string(rtype), rid, s.arg(), string(level), actor)
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("repo: set resource auth: %w", err)
	}
	return r.getResourceAuth(ctx, rtype, rid, s)
}

func (r *Repo) DeleteResourceAuth(ctx context.Context, rtype authz.ResourceType, rid int, s Subject) error {
	res, err := r.exec(ctx, `
DELETE FROM dbo.ftool_app_resource_auth
WHERE resource_type = @p1 AND resource_id = @p2 AND `+s.column()+` = `+s.castExpr("@p3"),
		string(rtype), rid, s.arg())
	if err != nil {
		return fmt.Errorf("repo: delete resource auth: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func deleteResourceAuthByResource(ctx context.Context, tx *sql.Tx, rtype authz.ResourceType, rid int) error {
	_, err := tx.ExecContext(ctx, appdb.Q(`
DELETE FROM dbo.ftool_app_resource_auth WHERE resource_type = @p1 AND resource_id = @p2`),
		string(rtype), rid)
	if err != nil {
		return fmt.Errorf("repo: clear resource auth: %w", err)
	}
	return nil
}
