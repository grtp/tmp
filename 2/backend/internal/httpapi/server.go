// Package httpapi implements the oapi-codegen generated ServerInterface
// (gen/api). API 契約は api/openapi.yaml が正であり、このパッケージは
// それに従うだけ。生成コードが無い状態ではコンパイルできないため、
// 先に `make generate` を実行すること。
package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	api "tablemaint/gen/api"
	"tablemaint/internal/auth"
	"tablemaint/internal/auth/roles"
	"tablemaint/internal/auth/session"
	"tablemaint/internal/store"
	"tablemaint/meta"
)

const claimsKey = "session.claims"

type Server struct {
	reg      *meta.Registry
	tables   *store.TableStore
	authn    auth.Authenticator
	resolver roles.Resolver
	sessions session.Manager
}

// コンパイル時に生成インターフェースへの適合を強制する。
var _ api.ServerInterface = (*Server)(nil)

func New(reg *meta.Registry, tables *store.TableStore, authn auth.Authenticator,
	resolver roles.Resolver, sessions session.Manager) *Server {
	return &Server{reg: reg, tables: tables, authn: authn, resolver: resolver, sessions: sessions}
}

// AuthMiddleware verifies the session cookie for every endpoint except
// login, and stores the claims in the gin context.
func (s *Server) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasSuffix(c.Request.URL.Path, "/auth/login") {
			c.Next()
			return
		}
		claims, err := s.sessions.Verify(c.Request)
		if err != nil {
			abortErr(c, http.StatusUnauthorized, "unauthorized", "ログインしてください")
			return
		}
		c.Set(claimsKey, claims)
		c.Next()
	}
}

func mustClaims(c *gin.Context) *session.Claims {
	return c.MustGet(claimsKey).(*session.Claims)
}

// ------------------------------------------------------------------ auth

func (s *Server) Login(c *gin.Context) {
	var req api.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	id, err := s.authn.Authenticate(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			abortErr(c, http.StatusUnauthorized, "invalid_credentials", "ユーザー名またはパスワードが違います")
			return
		}
		abortErr(c, http.StatusBadGateway, "ldap_unavailable", "認証サーバーに接続できません")
		return
	}

	role, err := s.resolver.EnsureUser(c.Request.Context(), id)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, "internal", "権限の解決に失敗しました")
		return
	}

	ck, err := s.sessions.Issue(session.Claims{
		ObjectGUID:  id.ObjectGUID,
		Username:    id.Username,
		DisplayName: id.DisplayName,
		Email:       id.Email,
		Role:        string(role),
	})
	if err != nil {
		abortErr(c, http.StatusInternalServerError, "internal", "セッションの発行に失敗しました")
		return
	}
	http.SetCookie(c.Writer, ck)
	c.JSON(http.StatusOK, meDTO(id.Username, id.DisplayName, id.Email, string(role)))
}

func (s *Server) Logout(c *gin.Context) {
	claims := mustClaims(c)
	_ = s.sessions.Revoke(claims.ObjectGUID) // JWT実装ではno-op(Redis移行時に意味を持つ)
	http.SetCookie(c.Writer, s.sessions.Expire())
	c.Status(http.StatusNoContent)
}

func (s *Server) GetMe(c *gin.Context) {
	cl := mustClaims(c)
	c.JSON(http.StatusOK, meDTO(cl.Username, cl.DisplayName, cl.Email, cl.Role))
}

// ---------------------------------------------------------------- tables

func (s *Server) ListTables(c *gin.Context) {
	role := mustClaims(c).Role
	out := []api.TableSummary{}
	for _, t := range s.reg.All() {
		if !t.CanRead(role) {
			continue
		}
		ts := api.TableSummary{
			Name:        t.Name,
			DisplayName: t.DisplayName,
			Writable:    t.CanWrite(role),
		}
		if t.Description != "" {
			ts.Description = ptr(t.Description)
		}
		out = append(out, ts)
	}
	c.JSON(http.StatusOK, gin.H{"tables": out})
}

func (s *Server) GetTableMeta(c *gin.Context, name string) {
	t, cl, ok := s.readableTable(c, name)
	if !ok {
		return
	}

	cols := make([]api.ColumnMeta, 0, len(t.Columns))
	for _, mc := range t.Columns {
		cm := api.ColumnMeta{
			Name:     mc.Name,
			Type:     api.ColumnMetaType(mc.Type),
			Nullable: mc.Nullable,
			Readonly: mc.Readonly,
		}
		if mc.DisplayName != "" {
			cm.DisplayName = ptr(mc.DisplayName)
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
		if mc.Min != nil {
			cm.Min = ptr(float32(*mc.Min))
		}
		if mc.Max != nil {
			cm.Max = ptr(float32(*mc.Max))
		}
		if len(mc.Enum) > 0 {
			vals := make([]interface{}, len(mc.Enum))
			for i, v := range mc.Enum {
				vals[i] = v
			}
			cm.Enum = ptr(vals)
		}
		cols = append(cols, cm)
	}

	tm := api.TableMeta{
		Name:        t.Name,
		DisplayName: t.DisplayName,
		PrimaryKey:  t.PrimaryKey,
		Writable:    t.CanWrite(cl.Role),
		Columns:     cols,
	}
	if t.RowVersionColumn != "" {
		tm.HasRowVersion = ptr(true)
	}
	c.JSON(http.StatusOK, tm)
}

// ListRows はクエリパラメータを自前で読む。生成された params 構造体を
// 使わないのは、rows/batch 系ではボディ/クエリの解釈を OpenAPI 契約
// (仕様書)にのみ結合させ、生成型の細部に依存しないため。
func (s *Server) ListRows(c *gin.Context, name string, _ api.ListRowsParams) {
	t, _, ok := s.readableTable(c, name)
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

	page, err := s.tables.ListRows(c.Request.Context(), t, store.ListParams{
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

func (s *Server) ApplyBatch(c *gin.Context, name string) {
	t, cl, ok := s.readableTable(c, name)
	if !ok {
		return
	}
	if !t.CanWrite(cl.Role) {
		abortErr(c, http.StatusForbidden, "forbidden", "このテーブルへの書き込み権限がありません")
		return
	}

	var req store.BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	result, err := s.tables.ApplyBatch(c.Request.Context(), t, req)
	if err != nil {
		s.writeStoreError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

// writeStoreError は store の型付きエラーを OpenAPI の Error/BatchError へ写像する。
func (s *Server) writeStoreError(c *gin.Context, err error) {
	var ve *store.ValidationError
	var fe *store.ForbiddenError
	var oe *store.OpError
	var pe *store.ProtectError

	switch {
	case errors.As(err, &ve):
		abortErr(c, http.StatusBadRequest, "validation_failed", ve.Msg)
	case errors.As(err, &fe):
		abortErr(c, http.StatusForbidden, "forbidden", fe.Msg)
	case errors.As(err, &oe):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"code":    "conflict",
			"message": oe.Msg,
			"details": gin.H{"operation": oe.Op, "index": oe.Index, "reason": oe.Reason},
		})
	case errors.As(err, &pe):
		abortErr(c, http.StatusConflict, "conflict", pe.Msg)
	default:
		abortErr(c, http.StatusInternalServerError, "internal", "処理に失敗しました")
	}
}

func intQuery(c *gin.Context, key string, def int) (int, error) {
	v := c.Query(key)
	if v == "" {
		return def, nil
	}
	return strconv.Atoi(v)
}

// ---------------------------------------------------------------- helpers

// readableTable resolves {name} and enforces 404/403. ok=false のとき
// レスポンスは書き込み済み。
func (s *Server) readableTable(c *gin.Context, name string) (*meta.TableDef, *session.Claims, bool) {
	cl := mustClaims(c)
	t, found := s.reg.Get(name)
	if !found {
		abortErr(c, http.StatusNotFound, "not_found", "テーブルが存在しません")
		return nil, nil, false
	}
	if !t.CanRead(cl.Role) {
		abortErr(c, http.StatusForbidden, "forbidden", "このテーブルの閲覧権限がありません")
		return nil, nil, false
	}
	return t, cl, true
}

func meDTO(username, displayName, email, role string) api.Me {
	m := api.Me{
		Username:    username,
		DisplayName: displayName,
		Role:        api.Role(role),
	}
	if email != "" {
		m.Email = ptr(email)
	}
	return m
}

func abortErr(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, api.Error{
		Code:    api.ErrorCode(code),
		Message: msg,
	})
}

func ptr[T any](v T) *T { return &v }
