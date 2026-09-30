package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
)

func (s *Server) ListSchemaTables(c *gin.Context, params api.ListSchemaTablesParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	filter := ""
	if params.Schema != nil {
		filter = *params.Schema
	}

	limit, ok := s.connSchemaLimit(c, params.ConnectionId)
	if !ok {
		return
	}
	if limit != "" {
		filter = limit
	}

	targetDB, err := s.pools.DB(c.Request.Context(), params.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}
	registered, err := s.repo.ListRegisteredNames(c.Request.Context(), params.ConnectionId)
	if err != nil {
		internalError(c, "registered names", err, "候補の取得に失敗しました")
		return
	}
	list, err := meta.ListCandidates(c.Request.Context(), targetDB, filter, registered)
	if err != nil {
		if conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return
		}
		internalError(c, "list candidates", err, "候補の取得に失敗しました")
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

func (s *Server) PreviewSchemaTable(c *gin.Context, schema string, table string, params api.PreviewSchemaTableParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	targetDB, err := s.pools.DB(c.Request.Context(), params.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}
	ins, err := meta.Introspect(c.Request.Context(), targetDB, schema, table)
	if err != nil {
		if conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return
		}
		internalError(c, "preview", err, "テーブル定義の取得に失敗しました")
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
