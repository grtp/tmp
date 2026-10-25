package authz

import (
	"context"
	"database/sql"
	"fmt"

	"f-tool/internal/auth/adguid"

	"f-tool/internal/appdb"
)

type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

const maxGroupDepth = 32

func (r *Resolver) GroupClosure(ctx context.Context, guid adguid.GUID) ([]int, error) {
	return r.groupClosureOn(ctx, r.db, guid)
}

func (r *Resolver) groupClosureOn(ctx context.Context, q Querier, guid adguid.GUID) ([]int, error) {
	const query = `
WITH g (group_id, depth) AS (
    SELECT group_id, 0
    FROM dbo.ftool_app_group_members
    WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
    UNION ALL
    SELECT m.group_id, g.depth + 1
    FROM dbo.ftool_app_group_members m
    JOIN g ON m.member_group_id = g.group_id
    WHERE g.depth < @p2
)
SELECT DISTINCT group_id FROM g`

	rows, err := q.QueryContext(ctx, appdb.Q(query), string(guid), maxGroupDepth)
	if err != nil {
		return nil, fmt.Errorf("authz: group closure: %w", err)
	}
	defer rows.Close()

	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("authz: scan group: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Resolver) HasSettingsAdminOn(ctx context.Context, q Querier, guid adguid.GUID) (bool, error) {
	groups, err := r.groupClosureOn(ctx, q, guid)
	if err != nil {
		return false, err
	}
	grants, err := r.grantsOn(ctx, q, guid, groups)
	if err != nil {
		return false, err
	}
	return grants.Allows(ActionSettings, LevelAdmin), nil
}
