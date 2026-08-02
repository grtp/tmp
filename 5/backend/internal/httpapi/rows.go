// rows: 動的テーブルのメタ取得・行の一覧/CSV出力/バッチ適用。
package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
	"f-tool/internal/predicate"
	"f-tool/internal/store"
)

// managedDef は {id} を実行時 TableDef に解決する。未登録・無効テーブルは
// 404 に落とす。ok=false のときレスポンスは書き込み済み。
func (s *Server) managedDef(c *gin.Context, id int) (*meta.TableDef, bool) {
	def, err := s.metas.TableDef(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, meta.ErrNotFound) {
			abortErr(c, http.StatusNotFound, "not_found", "テーブルが存在しません")
			return nil, false
		}
		if errors.Is(err, conn.ErrDisabled) || conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return nil, false
		}
		applog.From(c.Request.Context()).Error("table def failed", "managed_table_id", id, "err", err)
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
	if def.ConnectionID != nil {
		tm.ConnectionId = def.ConnectionID
		tm.ConnectionName = ptr(def.ConnectionName)
	}
	if len(def.InsertBlockedColumns) > 0 {
		tm.InsertBlockedColumns = ptr(def.InsertBlockedColumns)
	}
	c.JSON(http.StatusOK, tm)
}

// ListRows reads its query parameters by hand. 生成された params 構造体を
// 使わないのは,rows/batch 系ではボディ/クエリの解釈を OpenAPI 契約
// (仕様書)にのみ結合させ,生成型の細部に依存しないため。
func (s *Server) ListRows(c *gin.Context, id api.ManagedTableId, _ api.ListRowsParams) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}

	limit, err := intQuery(c, "limit", 100)
	if err != nil || limit < 1 || limit > 1000 {
		badRequest(c, "limit は 1〜1000 で指定してください")
		return
	}
	offset, err := intQuery(c, "offset", 0)
	if err != nil || offset < 0 {
		badRequest(c, "offset は 0 以上で指定してください")
		return
	}

	preds, err := predicate.ParseParam(c.Query("preds"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	page, err := s.tables.ListRows(c.Request.Context(), def, store.ListParams{
		Limit:   limit,
		Offset:  offset,
		Preds:   preds,
		OrderBy: c.Query("orderBy"),
		Order:   c.Query("order"),
	})
	if err != nil {
		s.writeStoreError(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

// ExportRows は列フィルタ適用後の全行を CSV でストリーム出力する。
func (s *Server) ExportRows(c *gin.Context, id api.ManagedTableId, _ api.ExportRowsParams) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}

	preds, err := predicate.ParseParam(c.Query("preds"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	// フィルタの検証エラー(不正列名など)をヘッダー送信前に検出するため,
	// まず WHERE を検証してからストリームを開始する。
	if _, _, err := store.ValidatePreds(def, preds); err != nil {
		s.writeStoreError(c, err)
		return
	}

	filename := fmt.Sprintf("%s.%s.csv", def.Schema, def.Table)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	n, err := s.tables.ExportCSV(c.Request.Context(), def, preds, c.Writer)
	target := auditTarget(def.ConnectionName, def.Schema, def.Table)
	if err != nil {
		// ストリーム開始後はステータスを変えられないため,ログと監査のみ。
		applog.From(c.Request.Context()).Error("export rows failed", "err", err)
		s.auditNG(c, authz.ActionTableMaint, "rows.export", target,
			gin.H{"rows": n, "error": err.Error()}, "internal")
		return
	}
	// データ持ち出しの監査: 対象と件数を記録する。
	s.auditOK(c, authz.ActionTableMaint, "rows.export", target,
		gin.H{"rows": n})
}

func (s *Server) ApplyBatch(c *gin.Context, id api.ManagedTableId) {
	if !s.require(c, authz.ActionTableMaint, authz.LevelMaintainer) {
		return
	}
	def, ok := s.managedDef(c, id)
	if !ok {
		return
	}

	var req store.BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	target := auditTarget(def.ConnectionName, def.Schema, def.Table)
	result, err := s.tables.ApplyBatch(c.Request.Context(), def, req)
	if err != nil {
		// 失敗も履歴に残す(全ロールバック済み)。
		s.auditNG(c, authz.ActionTableMaint, "rows.batch", target,
			gin.H{
				"inserts": len(req.Inserts), "updates": len(req.Updates), "deletes": len(req.Deletes),
				"error": err.Error(),
			}, batchErrorCode(err))
		s.writeStoreError(c, err)
		return
	}

	s.auditOK(c, authz.ActionTableMaint, "rows.batch", target,
		gin.H{
			"inserted": result.Inserted, "updated": result.Updated, "deleted": result.Deleted,
			"insertedKeys":     result.InsertedKeys,
			"inserts":          req.Inserts,
			"changes":          result.Changes,
			"changesTruncated": result.ChangesTruncated,
		})
	c.JSON(http.StatusOK, result)
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
		if mc.Fixed {
			cm.Fixed = ptr(true)
		}
		out = append(out, cm)
	}
	return out
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
