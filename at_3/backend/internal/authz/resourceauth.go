package authz

import (
	"context"
	"fmt"
	"strings"

	"f-tool/internal/auth/adguid"

	"f-tool/internal/appdb"
)

type ResourceLevel string

const (
	ResourceRead      ResourceLevel = "r"
	ResourceReadWrite ResourceLevel = "rw"
)

func (l ResourceLevel) Valid() bool {
	return l == ResourceRead || l == ResourceReadWrite
}

var resourceRank = map[ResourceLevel]int{ResourceRead: 1, ResourceReadWrite: 2}

func (l ResourceLevel) Covers(min ResourceLevel) bool { return resourceRank[l] >= resourceRank[min] }

func maxResourceLevel(a, b ResourceLevel) ResourceLevel {
	if resourceRank[b] > resourceRank[a] {
		return b
	}
	return a
}

type ResourceType string

const (
	ResourceTypeAction       ResourceType = "action"
	ResourceTypeManagedTable ResourceType = "managed_table"
)

func (t ResourceType) Valid() bool {
	return t == ResourceTypeAction || t == ResourceTypeManagedTable
}

type ResourceGrants struct {
	byTable  map[int]ResourceLevel
	byAction map[string]ResourceLevel
}

func (g *ResourceGrants) AllowsAction(code string, min ResourceLevel) bool {
	lv, ok := g.byAction[code]
	return ok && lv.Covers(min)
}

func (g *ResourceGrants) AllowsTable(tableID int, min ResourceLevel) bool {
	lv, ok := g.byTable[tableID]
	if parent, pok := g.byAction[ActionTables]; pok {
		if ok {
			lv = maxResourceLevel(lv, parent)
		} else {
			lv, ok = parent, true
		}
	}
	return ok && lv.Covers(min)
}

func (r *Resolver) ResourceGrants(ctx context.Context, guid adguid.GUID, groupIDs []int) (*ResourceGrants, error) {
	return r.resourceGrantsOn(ctx, r.db, guid, groupIDs)
}

func (r *Resolver) resourceGrantsOn(ctx context.Context, q Querier, guid adguid.GUID, groupIDs []int) (*ResourceGrants, error) {
	args := []any{string(guid)}
	where := `ra.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`
	if len(groupIDs) > 0 {
		ph, extra := inPlaceholders(len(args)+1, groupIDs)
		args = append(args, extra...)
		where += ` OR ra.group_id IN (` + ph + `)`
	}

	query := `
SELECT ra.resource_type, ra.resource_id, COALESCE(a.code, N''), ra.auth_level
FROM dbo.ftool_app_resource_auth ra
LEFT JOIN dbo.ftool_app_actions a ON ra.resource_type = N'action' AND a.id = ra.resource_id
WHERE ` + where

	rows, err := q.QueryContext(ctx, appdb.Q(query), args...)
	if err != nil {
		return nil, fmt.Errorf("authz: resource grants: %w", err)
	}
	defer rows.Close()

	out := &ResourceGrants{byTable: map[int]ResourceLevel{}, byAction: map[string]ResourceLevel{}}
	for rows.Next() {
		var rtype, code, level string
		var rid int
		if err := rows.Scan(&rtype, &rid, &code, &level); err != nil {
			return nil, fmt.Errorf("authz: scan resource grant: %w", err)
		}
		lv := ResourceLevel(level)
		if !lv.Valid() {
			return nil, fmt.Errorf("authz: unexpected resource auth_level %q", level)
		}
		switch ResourceType(rtype) {
		case ResourceTypeManagedTable:
			if cur, ok := out.byTable[rid]; ok {
				lv = maxResourceLevel(cur, lv)
			}
			out.byTable[rid] = lv
		case ResourceTypeAction:
			if code == "" {
				continue
			}
			if cur, ok := out.byAction[code]; ok {
				lv = maxResourceLevel(cur, lv)
			}
			out.byAction[code] = lv
		default:
			return nil, fmt.Errorf("authz: unexpected resource_type %q", rtype)
		}
	}
	return out, rows.Err()
}

func inPlaceholders(start int, ids []int) (string, []any) {
	ph := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		ph[i] = fmt.Sprintf("@p%d", start+i)
		args[i] = id
	}
	return strings.Join(ph, ", "), args
}
