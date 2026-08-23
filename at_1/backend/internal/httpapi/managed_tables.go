package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
	"f-tool/internal/repo"
)

var slugRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)

func (s *Server) ListManagedTables(c *gin.Context, params api.ListManagedTablesParams) {
	all := params.All != nil && *params.All
	if all {
		if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
			return
		}
	} else if !s.require(c, authz.ActionTables, authz.LevelUser) {
		return
	}

	list, err := s.repo.ListManagedTables(c.Request.Context(), all)
	if err != nil {
		internalError(c, "list managed tables", err, "一覧の取得に失敗しました")
		return
	}

	targets := make([]string, len(list))
	for i, m := range list {
		targets[i] = auditTarget(m.ConnectionName, m.SchemaName, m.TableName)
	}
	lastActivity, err := s.repo.LastActivityByTarget(c.Request.Context(), targets)
	if err != nil {
		internalError(c, "list managed tables", err, "一覧の取得に失敗しました")
		return
	}

	writable := mustGrants(c).Allows(authz.ActionTables, authz.LevelMaintainer)
	out := make([]api.ManagedTable, 0, len(list))
	for _, m := range list {
		dto := managedTableDTO(m, writable)
		if at, ok := lastActivity[auditTarget(m.ConnectionName, m.SchemaName, m.TableName)]; ok {
			dto.LastActivityAt = &at
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, gin.H{"tables": out})
}

func (s *Server) connSchemaLimit(c *gin.Context, connID *int) (string, bool) {
	if connID == nil {
		return "", true
	}
	cn, err := s.conns.Get(c.Request.Context(), *connID)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return "", false
	}
	return cn.SchemaName, true
}

func (s *Server) CreateManagedTable(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ManagedTableCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		badRequest(c, "displayName は必須です")
		return
	}
	if !slugRe.MatchString(req.Slug) {
		badRequest(c, "管理名は英字で始まる半角英数字・ハイフン・アンダースコア(64文字以内)で入力してください")
		return
	}

	if strings.HasPrefix(strings.ToLower(req.TableName), "ftool_app_") {
		badRequest(c, "ftool_app_ で始まるテーブルは登録できません")
		return
	}

	limit, ok := s.connSchemaLimit(c, req.ConnectionId)
	if !ok {
		return
	}
	if limit != "" && !strings.EqualFold(strings.TrimSpace(req.SchemaName), limit) {
		abortErr(c, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("この接続では %s スキーマのテーブルのみ登録できます", limit))
		return
	}

	targetDB, err := s.pools.DB(c.Request.Context(), req.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}
	ins, err := meta.Introspect(c.Request.Context(), targetDB, req.SchemaName, req.TableName)
	if err != nil {
		if conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return
		}
		internalError(c, "introspect", err, "テーブル定義の取得に失敗しました")
		return
	}
	if ins == nil {
		abortErr(c, http.StatusNotFound, "not_found",
			fmt.Sprintf("テーブル %s.%s が存在しません", req.SchemaName, req.TableName))
		return
	}
	if len(ins.PrimaryKey) == 0 {
		abortErr(c, http.StatusConflict, "conflict", "主キーの無いテーブルは登録できません")
		return
	}

	roCSV, hdCSV, fxJSON, err := columnModesCSV(ins, req.ReadonlyColumns, req.HiddenColumns, req.FixedColumns)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	m := repo.ManagedTable{
		ConnectionID:    req.ConnectionId,
		SchemaName:      ins.Schema,
		TableName:       ins.Table,
		DisplayName:     req.DisplayName,
		Slug:            req.Slug,
		PKColumns:       strings.Join(ins.PrimaryKey, ","),
		ReadonlyColumns: roCSV,
		HiddenColumns:   hdCSV,
		FixedColumns:    fxJSON,
		CreatedBy:       cl.Username,
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.SortOrder != nil {
		m.SortOrder = *req.SortOrder
	}

	created, err := s.repo.CreateManagedTable(c.Request.Context(), m)
	if err != nil {
		s.writeRepoError(c, err, "登録に失敗しました")
		return
	}

	s.auditOK(c, authz.ActionSettings, "managed-table.create", auditTarget(created.ConnectionName, created.SchemaName, created.TableName),
		gin.H{"id": created.ID, "displayName": created.DisplayName, "slug": created.Slug,
			"connectionId": created.ConnectionID, "connectionName": created.ConnectionName,
			"readonlyColumns": splitCSV(created.ReadonlyColumns), "hiddenColumns": splitCSV(created.HiddenColumns),
			"fixedColumns": json.RawMessage(orEmptyArray(created.FixedColumns))})
	writable := mustGrants(c).Allows(authz.ActionTables, authz.LevelMaintainer)
	c.JSON(http.StatusCreated, managedTableDTO(*created, writable))
}

func (s *Server) UpdateManagedTable(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ManagedTableUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.Slug != nil && !slugRe.MatchString(*req.Slug) {
		badRequest(c, "管理名は英字で始まる半角英数字・ハイフン・アンダースコア(64文字以内)で入力してください")
		return
	}

	var roCSV, hdCSV, fxJSONPtr *string
	if req.ReadonlyColumns != nil || req.HiddenColumns != nil || req.FixedColumns != nil {
		cur, err := s.repo.GetManagedTable(c.Request.Context(), id)
		if err != nil {
			s.writeRepoError(c, err, "更新に失敗しました")
			return
		}
		targetDB, err := s.pools.DB(c.Request.Context(), cur.ConnectionID)
		if err != nil {
			s.writeConnError(c, err, "接続の解決に失敗しました")
			return
		}
		ins, err := meta.Introspect(c.Request.Context(), targetDB, cur.SchemaName, cur.TableName)
		if err != nil || ins == nil {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "テーブル定義の取得に失敗しました")
			return
		}

		roList, hdList, fxList := req.ReadonlyColumns, req.HiddenColumns, req.FixedColumns
		if roList == nil {
			roList = ptr(splitCSV(cur.ReadonlyColumns))
		}
		if hdList == nil {
			hdList = ptr(splitCSV(cur.HiddenColumns))
		}
		if fxList == nil {
			curFixed, err := meta.ParseFixedColumns(cur.FixedColumns)
			if err != nil {
				abortErr(c, http.StatusInternalServerError, "internal", "固定値指定の読み込みに失敗しました")
				return
			}
			fxList = ptr(fixedToAPI(curFixed))
		}
		newRO, newHD, newFX, err := columnModesCSV(ins, roList, hdList, fxList)
		if err != nil {
			badRequest(c, err.Error())
			return
		}
		roCSV, hdCSV, fxJSONPtr = &newRO, &newHD, &newFX
	}

	updated, err := s.repo.UpdateManagedTable(c.Request.Context(), id,
		req.DisplayName, req.Slug, req.Description, req.SortOrder, req.Enabled, roCSV, hdCSV, fxJSONPtr, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "更新に失敗しました")
		return
	}
	s.metas.Invalidate(id)

	s.auditOK(c, authz.ActionSettings, "managed-table.update", auditTarget(updated.ConnectionName, updated.SchemaName, updated.TableName),
		req)
	writable := mustGrants(c).Allows(authz.ActionTables, authz.LevelMaintainer)
	c.JSON(http.StatusOK, managedTableDTO(*updated, writable))
}

func (s *Server) DeleteManagedTable(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	m, err := s.repo.GetManagedTable(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "削除に失敗しました")
		return
	}
	if err := s.repo.DeleteManagedTable(c.Request.Context(), id); err != nil {
		s.writeRepoError(c, err, "削除に失敗しました")
		return
	}
	s.metas.Invalidate(id)

	s.auditOK(c, authz.ActionSettings, "managed-table.delete", auditTarget(m.ConnectionName, m.SchemaName, m.TableName),
		gin.H{"id": id, "displayName": m.DisplayName})
	c.Status(http.StatusNoContent)
}

func auditTarget(connName, schema, table string) string {
	if connName == "" {
		return schema + "." + table
	}
	return connName + ":" + schema + "." + table
}

func columnModesCSV(ins *meta.Introspection, ro, hd *[]string, fx *[]api.FixedColumn) (string, string, string, error) {
	var roList, hdList []string
	if ro != nil {
		roList = *ro
	}
	if hd != nil {
		hdList = *hd
	}
	var fixed []meta.FixedColumn
	if fx != nil {
		for _, f := range *fx {
			mf := meta.FixedColumn{Name: f.Name, Kind: string(f.Kind), ApplyOn: string(f.ApplyOn)}
			if f.Value != nil {
				mf.Value = *f.Value
			}
			fixed = append(fixed, mf)
		}
	}
	return meta.NormalizeColumnModes(ins, roList, hdList, fixed)
}

func splitCSV(csv string) []string {
	var out []string
	for _, s := range strings.Split(csv, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func managedTableDTO(m repo.ManagedTable, writable bool) api.ManagedTable {
	out := api.ManagedTable{
		Id:          m.ID,
		SchemaName:  m.SchemaName,
		TableName:   m.TableName,
		DisplayName: m.DisplayName,
		Slug:        m.Slug,
		SortOrder:   m.SortOrder,
		Enabled:     m.Enabled,
		Writable:    writable && m.Enabled,
		CreatedAt:   m.CreatedAt,
	}
	if m.Description != "" {
		out.Description = ptr(m.Description)
	}
	if m.ConnectionID != nil {
		out.ConnectionId = m.ConnectionID
		out.ConnectionName = ptr(m.ConnectionName)
	}
	if ro := splitCSV(m.ReadonlyColumns); len(ro) > 0 {
		out.ReadonlyColumns = ptr(ro)
	}
	if hd := splitCSV(m.HiddenColumns); len(hd) > 0 {
		out.HiddenColumns = ptr(hd)
	}
	if fixed, err := meta.ParseFixedColumns(m.FixedColumns); err == nil && len(fixed) > 0 {
		out.FixedColumns = ptr(fixedToAPI(fixed))
	}
	return out
}

func fixedToAPI(in []meta.FixedColumn) []api.FixedColumn {
	out := make([]api.FixedColumn, 0, len(in))
	for _, f := range in {
		a := api.FixedColumn{
			Name:    f.Name,
			Kind:    api.FixedColumnKind(f.Kind),
			ApplyOn: api.FixedColumnApplyOn(f.ApplyOn),
		}
		if f.Value != "" {
			a.Value = ptr(f.Value)
		}
		out = append(out, a)
	}
	return out
}

func orEmptyArray(s string) string {
	if strings.TrimSpace(s) == "" {
		return "[]"
	}
	return s
}
