package httpapi

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	api "tablemaint/gen/api"
	"tablemaint/internal/admin"
	"tablemaint/internal/audit"
	"tablemaint/internal/authz"
	"tablemaint/internal/meta"
	"tablemaint/internal/store"
)

// -------------------------------------------------------- managed tables

func (s *Server) ListManagedTables(c *gin.Context, params api.ListManagedTablesParams) {
	all := params.All != nil && *params.All
	if all {
		if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
			return
		}
	} else if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
		return
	}

	list, err := s.repo.ListManagedTables(c.Request.Context(), all)
	if err != nil {
		log.Printf("httpapi: list managed tables: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "一覧の取得に失敗しました")
		return
	}
	writable := mustGrants(c).Allows(authz.ActionTableMaint, authz.LevelMaintainer)
	out := make([]api.ManagedTable, 0, len(list))
	for _, m := range list {
		out = append(out, managedTableDTO(m, writable))
	}
	c.JSON(http.StatusOK, gin.H{"tables": out})
}

func (s *Server) CreateManagedTable(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ManagedTableCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", "displayName は必須です")
		return
	}
	// 本ツール自身のテーブルは管理対象にしない(自己破壊の防止)。
	if strings.HasPrefix(strings.ToLower(req.TableName), "app_") {
		abortErr(c, http.StatusBadRequest, "validation_failed", "app_ で始まるテーブルは登録できません")
		return
	}

	// カタログと突合: 実在しない -> 404、PK なし -> 409。
	ins, err := meta.Introspect(c.Request.Context(), s.db, req.SchemaName, req.TableName)
	if err != nil {
		log.Printf("httpapi: introspect: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "テーブル定義の取得に失敗しました")
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

	m := admin.ManagedTable{
		SchemaName:  ins.Schema,
		TableName:   ins.Table,
		DisplayName: req.DisplayName,
		PKColumns:   strings.Join(ins.PrimaryKey, ","),
		CreatedBy:   cl.Username,
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.SortOrder != nil {
		m.SortOrder = *req.SortOrder
	}

	created, err := s.repo.CreateManagedTable(c.Request.Context(), m)
	if err != nil {
		s.writeAdminError(c, err, "登録に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "managed-table.create",
		Target: created.SchemaName + "." + created.TableName,
		Detail: gin.H{"id": created.ID, "displayName": created.DisplayName},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	writable := mustGrants(c).Allows(authz.ActionTableMaint, authz.LevelMaintainer)
	c.JSON(http.StatusCreated, managedTableDTO(*created, writable))
}

func (s *Server) UpdateManagedTable(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ManagedTableUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	updated, err := s.repo.UpdateManagedTable(c.Request.Context(), id,
		req.DisplayName, req.Description, req.SortOrder, req.Enabled)
	if err != nil {
		s.writeAdminError(c, err, "更新に失敗しました")
		return
	}
	s.metas.Invalidate(id)

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "managed-table.update",
		Target: updated.SchemaName + "." + updated.TableName,
		Detail: req, Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	writable := mustGrants(c).Allows(authz.ActionTableMaint, authz.LevelMaintainer)
	c.JSON(http.StatusOK, managedTableDTO(*updated, writable))
}

func (s *Server) DeleteManagedTable(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	m, err := s.repo.GetManagedTable(c.Request.Context(), id)
	if err != nil {
		s.writeAdminError(c, err, "削除に失敗しました")
		return
	}
	if err := s.repo.DeleteManagedTable(c.Request.Context(), id); err != nil {
		s.writeAdminError(c, err, "削除に失敗しました")
		return
	}
	s.metas.Invalidate(id)

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "managed-table.delete",
		Target: m.SchemaName + "." + m.TableName,
		Detail: gin.H{"id": id, "displayName": m.DisplayName},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

// --------------------------------------------------------- meta / rows

// managedDef resolves {id} into a runtime TableDef, enforcing 404 for
// unknown/disabled tables. ok=false のときレスポンスは書き込み済み。
func (s *Server) managedDef(c *gin.Context, id int) (*meta.TableDef, bool) {
	def, err := s.metas.TableDef(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, meta.ErrNotFound) {
			abortErr(c, http.StatusNotFound, "not_found", "テーブルが存在しません")
			return nil, false
		}
		log.Printf("httpapi: table def(%d): %v", id, err)
		abortErr(c, http.StatusInternalServerError, "internal", "テーブル定義の取得に失敗しました")
		return nil, false
	}
	if !def.Enabled {
		abortErr(c, http.StatusNotFound, "not_found", "テーブルが存在しません")
		return nil, false
	}
	return def, true
}

func (s *Server) GetTableMeta(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}
	writable := mustGrants(c).Allows(authz.ActionTableMaint, authz.LevelMaintainer)

	tm := api.TableMeta{
		Id:            def.ID,
		SchemaName:    ptr(def.Schema),
		TableName:     ptr(def.Table),
		DisplayName:   def.DisplayName,
		PrimaryKey:    def.PrimaryKey,
		HasRowVersion: def.RowVersionColumn != "",
		Writable:      writable,
		Columns:       columnsDTO(def.Columns),
	}
	c.JSON(http.StatusOK, tm)
}

// ListRows はクエリパラメータを自前で読む。生成された params 構造体を
// 使わないのは、rows/batch 系ではボディ/クエリの解釈を OpenAPI 契約
// (仕様書)にのみ結合させ、生成型の細部に依存しないため。
func (s *Server) ListRows(c *gin.Context, id api.ManagedTableId, _ api.ListRowsParams) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}

	limit, err := intQuery(c, "limit", 100)
	if err != nil || limit < 1 || limit > 200 {
		abortErr(c, http.StatusBadRequest, "validation_failed", "limit は 1〜200 で指定してください")
		return
	}
	offset, err := intQuery(c, "offset", 0)
	if err != nil || offset < 0 {
		abortErr(c, http.StatusBadRequest, "validation_failed", "offset は 0 以上で指定してください")
		return
	}

	page, err := s.tables.ListRows(c.Request.Context(), def, store.ListParams{
		Limit:   limit,
		Offset:  offset,
		Q:       c.Query("q"),
		OrderBy: c.Query("orderBy"),
		Order:   c.Query("order"),
	})
	if err != nil {
		s.writeStoreError(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func (s *Server) ApplyBatch(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelMaintainer) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}
	cl := mustClaims(c)

	var req store.BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	target := def.Schema + "." + def.Table
	result, err := s.tables.ApplyBatch(c.Request.Context(), def, req)
	if err != nil {
		// 失敗も履歴に残す(全ロールバック済み)。
		s.audits.Write(c.Request.Context(), audit.Entry{
			ObjectGUID: cl.ObjectGUID, Username: cl.Username,
			ActionCode: authz.ActionTableMaint, Operation: "rows.batch",
			Target: target,
			Detail: gin.H{
				"inserts": len(req.Inserts), "updates": len(req.Updates), "deletes": len(req.Deletes),
				"error": err.Error(),
			},
			Result: audit.ResultFailure, ErrorCode: batchErrorCode(err), ClientIP: c.ClientIP(),
		})
		s.writeStoreError(c, err)
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionTableMaint, Operation: "rows.batch",
		Target: target,
		Detail: gin.H{
			"inserted": result.Inserted, "updated": result.Updated, "deleted": result.Deleted,
			"insertedKeys": result.InsertedKeys,
			"updates":      req.Updates, "deletes": req.Deletes, "inserts": req.Inserts,
		},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, result)
}

// ---------------------------------------------------------------- schema

func (s *Server) ListSchemaTables(c *gin.Context, params api.ListSchemaTablesParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	filter := ""
	if params.Schema != nil {
		filter = *params.Schema
	}
	list, err := meta.ListCandidates(c.Request.Context(), s.db, filter)
	if err != nil {
		log.Printf("httpapi: list candidates: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "候補の取得に失敗しました")
		return
	}
	out := make([]api.SchemaTable, 0, len(list))
	for _, t := range list {
		out = append(out, api.SchemaTable{
			SchemaName:    t.Schema,
			TableName:     t.Table,
			HasPrimaryKey: t.HasPrimaryKey,
		})
	}
	c.JSON(http.StatusOK, gin.H{"tables": out})
}

func (s *Server) PreviewSchemaTable(c *gin.Context, schema string, table string) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	ins, err := meta.Introspect(c.Request.Context(), s.db, schema, table)
	if err != nil {
		log.Printf("httpapi: preview: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "テーブル定義の取得に失敗しました")
		return
	}
	if ins == nil {
		abortErr(c, http.StatusNotFound, "not_found", "テーブルが存在しません")
		return
	}
	pk := ins.PrimaryKey
	if pk == nil {
		pk = []string{}
	}
	c.JSON(http.StatusOK, api.SchemaTablePreview{
		SchemaName:    ins.Schema,
		TableName:     ins.Table,
		PrimaryKey:    pk,
		HasRowVersion: ins.RowVersionColumn != "",
		Columns:       columnsDTO(ins.Columns),
	})
}

// ---------------------------------------------------------------- shared

func managedTableDTO(m admin.ManagedTable, writable bool) api.ManagedTable {
	out := api.ManagedTable{
		Id:          m.ID,
		SchemaName:  m.SchemaName,
		TableName:   m.TableName,
		DisplayName: m.DisplayName,
		SortOrder:   m.SortOrder,
		Enabled:     m.Enabled,
		Writable:    writable && m.Enabled,
	}
	if m.Description != "" {
		out.Description = ptr(m.Description)
	}
	return out
}

func columnsDTO(cols []meta.Column) []api.ColumnMeta {
	out := make([]api.ColumnMeta, 0, len(cols))
	for _, mc := range cols {
		cm := api.ColumnMeta{
			Name:     mc.Name,
			Type:     api.ColumnMetaType(mc.Type),
			Nullable: mc.Nullable,
			Readonly: mc.Readonly,
		}
		if mc.Required {
			cm.Required = ptr(true)
		}
		if mc.Searchable {
			cm.Searchable = ptr(true)
		}
		if mc.MaxLength > 0 {
			cm.MaxLength = ptr(mc.MaxLength)
		}
		out = append(out, cm)
	}
	return out
}

// writeStoreError は store の型付きエラーを OpenAPI の Error/BatchError へ写像する。
func (s *Server) writeStoreError(c *gin.Context, err error) {
	var ve *store.ValidationError
	var oe *store.OpError

	switch {
	case errors.As(err, &ve):
		abortErr(c, http.StatusBadRequest, "validation_failed", ve.Msg)
	case errors.As(err, &oe):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"code":    "conflict",
			"message": oe.Msg,
			"details": gin.H{"operation": oe.Op, "index": oe.Index, "reason": oe.Reason},
		})
	default:
		log.Printf("httpapi: store: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "処理に失敗しました")
	}
}

// writeAdminError は admin リポジトリのエラーを HTTP へ写像する。
func (s *Server) writeAdminError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, admin.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "対象が存在しません")
	case errors.Is(err, admin.ErrConflict):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	default:
		log.Printf("httpapi: admin: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", fallback)
	}
}

func batchErrorCode(err error) string {
	var ve *store.ValidationError
	var oe *store.OpError
	switch {
	case errors.As(err, &ve):
		return "validation_failed"
	case errors.As(err, &oe):
		return "conflict"
	default:
		return "internal"
	}
}

func intQuery(c *gin.Context, key string, def int) (int, error) {
	v := c.Query(key)
	if v == "" {
		return def, nil
	}
	return strconv.Atoi(v)
}
