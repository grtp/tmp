package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/audit"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
)

// 接続管理は全て settings:admin。パスワードはレスポンスに決して載せない。

func (s *Server) ListConnections(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.conns.List(c.Request.Context())
	if err != nil {
		log.Printf("httpapi: list connections: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "接続一覧の取得に失敗しました")
		return
	}
	out := make([]api.Connection, 0, len(list))
	for _, x := range list {
		out = append(out, connectionDTO(x))
	}
	c.JSON(http.StatusOK, gin.H{"connections": out})
}

func (s *Server) CreateConnection(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ConnectionCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if msg := validateConnFields(req.Name, req.Host, req.DatabaseName, req.Username); msg != "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", msg)
		return
	}
	if req.Password == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", "password は必須です")
		return
	}

	p := conn.CreateParams{
		Name:         strings.TrimSpace(req.Name),
		Host:         strings.TrimSpace(req.Host),
		Port:         1433,
		DatabaseName: strings.TrimSpace(req.DatabaseName),
		Username:     req.Username,
		Password:     req.Password,
		Enabled:      true,
		CreatedBy:    cl.Username,
	}
	if req.Port != nil {
		p.Port = *req.Port
	}
	if req.Options != nil {
		p.Options = *req.Options
	}
	if req.SchemaName != nil {
		p.SchemaName = strings.TrimSpace(*req.SchemaName)
	}
	if req.Enabled != nil {
		p.Enabled = *req.Enabled
	}

	created, err := s.conns.Create(c.Request.Context(), p)
	if err != nil {
		s.writeConnError(c, err, "接続の登録に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "connection.create",
		Target: "conn:" + created.Name,
		Detail: gin.H{"id": created.ID, "host": created.Host, "database": created.DatabaseName,
			"schema": created.SchemaName},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusCreated, connectionDTO(*created))
}

func (s *Server) UpdateConnection(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ConnectionUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if req.Password != nil && *req.Password == "" {
		// 空文字は「変更なし」ではなく入力ミスの可能性が高いので拒否する。
		abortErr(c, http.StatusBadRequest, "validation_failed", "password を空にはできません(変更しない場合は送らないでください)")
		return
	}

	var schemaName *string
	if req.SchemaName != nil {
		t := strings.TrimSpace(*req.SchemaName)
		schemaName = &t
	}
	updated, err := s.conns.Update(c.Request.Context(), id, conn.UpdateParams{
		Name:         req.Name,
		Host:         req.Host,
		Port:         req.Port,
		DatabaseName: req.DatabaseName,
		Username:     req.Username,
		Password:     req.Password,
		Options:      req.Options,
		SchemaName:   schemaName,
		Enabled:      req.Enabled,
	}, cl.Username)
	if err != nil {
		s.writeConnError(c, err, "接続の更新に失敗しました")
		return
	}

	// 資格情報・接続先が変わった可能性があるためプールとメタキャッシュを破棄。
	s.pools.Invalidate(id)
	s.metas.InvalidateAll()

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "connection.update",
		Target: "conn:" + updated.Name,
		Detail: gin.H{"id": id, "passwordChanged": req.Password != nil},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, connectionDTO(*updated))
}

func (s *Server) DeleteConnection(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	target, err := s.conns.Get(c.Request.Context(), id)
	if err != nil {
		s.writeConnError(c, err, "接続の削除に失敗しました")
		return
	}
	if err := s.conns.Delete(c.Request.Context(), id); err != nil {
		s.writeConnError(c, err, "接続の削除に失敗しました")
		return
	}
	s.pools.Invalidate(id)
	s.metas.InvalidateAll()

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "connection.delete",
		Target: "conn:" + target.Name,
		Detail: gin.H{"id": id, "host": target.Host, "database": target.DatabaseName},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

// TestConnection pings a saved connection. 失敗も 200 (ok=false) で返し，
// UI がそのまま結果表示できるようにする。
func (s *Server) TestConnection(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	dsn, err := s.conns.DSN(c.Request.Context(), id)
	if err != nil {
		s.writeConnError(c, err, "接続情報の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, s.runConnTest(c, dsn))
}

// TestConnectionParams pings unsaved parameters (保存前テスト)。
func (s *Server) TestConnectionParams(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	var req api.ConnectionCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if msg := validateConnFields(req.Name, req.Host, req.DatabaseName, req.Username); msg != "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", msg)
		return
	}
	port := 1433
	if req.Port != nil {
		port = *req.Port
	}
	options := ""
	if req.Options != nil {
		options = *req.Options
	}
	dsn := conn.BuildDSN(strings.TrimSpace(req.Host), port,
		strings.TrimSpace(req.DatabaseName), req.Username, req.Password, options)
	c.JSON(http.StatusOK, s.runConnTest(c, dsn))
}

func (s *Server) runConnTest(c *gin.Context, dsn string) api.ConnectionTestResult {
	start := time.Now()
	if err := s.pools.Test(c.Request.Context(), dsn); err != nil {
		return api.ConnectionTestResult{Ok: false, Message: ptr(testFailureMessage(err))}
	}
	ms := int(time.Since(start).Milliseconds())
	return api.ConnectionTestResult{Ok: true, LatencyMs: &ms}
}

// testFailureMessage は生エラーを短い日本語 + 元メッセージに整える。
// 資格情報はエラーに含まれないが，長大なスタックは切り詰める。
func testFailureMessage(err error) string {
	msg := err.Error()
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	return "接続できません: " + msg
}

func validateConnFields(name, host, database, username string) string {
	switch {
	case strings.TrimSpace(name) == "":
		return "name は必須です"
	case strings.TrimSpace(host) == "":
		return "host は必須です"
	case strings.TrimSpace(database) == "":
		return "databaseName は必須です"
	case strings.TrimSpace(username) == "":
		return "username は必須です"
	}
	return ""
}

func connectionDTO(x conn.Connection) api.Connection {
	out := api.Connection{
		Id:           x.ID,
		Name:         x.Name,
		Host:         x.Host,
		Port:         x.Port,
		DatabaseName: x.DatabaseName,
		Username:     x.Username,
		Enabled:      x.Enabled,
	}
	if x.Options != "" {
		out.Options = ptr(x.Options)
	}
	if x.SchemaName != "" {
		out.SchemaName = ptr(x.SchemaName)
	}
	return out
}

// writeConnError は conn パッケージのエラーを HTTP へ写像する。
func (s *Server) writeConnError(c *gin.Context, err error, fallback string) {
	switch {
	case err == nil:
		return
	case errors.Is(err, conn.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "接続が存在しません")
	case errors.Is(err, conn.ErrInUse):
		abortErr(c, http.StatusConflict, "conflict", "管理対象テーブルがこの接続を参照しています")
	case errors.Is(err, conn.ErrConflict):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	case errors.Is(err, conn.ErrDisabled):
		abortErr(c, http.StatusConflict, "conflict", "この接続は無効化されています")
	case conn.IsUnreachable(err):
		abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
	default:
		log.Printf("httpapi: conn: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", fallback)
	}
}
