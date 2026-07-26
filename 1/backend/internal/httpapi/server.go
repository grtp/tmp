// Package httpapi は oapi-codegen 生成の ServerInterface を実装する
// (gen/api). API 契約は api/openapi.yaml が正であり，このパッケージは
// それに従うだけ。生成コードが無い状態ではコンパイルできないため，
// 先に `make generate` を実行すること。
package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/audit"
	"f-tool/internal/auth"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
	"f-tool/internal/repo"
	"f-tool/internal/session"
	"f-tool/internal/store"
)

const (
	claimsKey = "session.claims"
	grantsKey = "session.grants"
	sidKey    = "session.sid"
)

type Server struct {
	metas    *meta.Service
	tables   *store.TableStore
	authn    auth.Authenticator
	resolver *authz.Resolver
	sessions *session.Store
	repo     *repo.Repo
	audits   *audit.Recorder
	conns    *conn.Repo
	pools    *conn.Manager
	// アプリ自身の DB(ftool_app_* テーブル用)
	db *sql.DB
	// 監査履歴 detail の 1MB 超過分の取得用(nil = 未設定。§S11)
	blobs BlobGetter
}

// BlobGetter は監査 overflow 読み出し専用の最小インターフェース
// (internal/blobstore.Store が実装)。
type BlobGetter interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

// コンパイル時に生成インターフェースへの適合を強制する。
var _ api.ServerInterface = (*Server)(nil)

type Deps struct {
	DB       *sql.DB
	Metas    *meta.Service
	Tables   *store.TableStore
	Authn    auth.Authenticator
	Resolver *authz.Resolver
	Sessions *session.Store
	Repo     *repo.Repo
	Audits   *audit.Recorder
	Conns    *conn.Repo
	Pools    *conn.Manager
	Blobs    BlobGetter // nil = 監査履歴の overflow 取得を無効化
}

func New(d Deps) *Server {
	return &Server{
		metas:    d.Metas,
		tables:   d.Tables,
		authn:    d.Authn,
		resolver: d.Resolver,
		sessions: d.Sessions,
		repo:     d.Repo,
		audits:   d.Audits,
		conns:    d.Conns,
		pools:    d.Pools,
		db:       d.DB,
		blobs:    d.Blobs,
	}
}

// AuthMiddleware は login 以外の全エンドポイントでセッション cookie を検証し，
// Valkey の TTL を先送りし，機能別権限を解決して gin コンテキストへ格納する。
func (s *Server) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasSuffix(c.Request.URL.Path, "/auth/login") {
			c.Next()
			return
		}
		sid := s.sessions.SIDFromRequest(c.Request)
		if sid == "" {
			abortErr(c, http.StatusUnauthorized, "unauthorized", "ログインしてください")
			return
		}
		cl, err := s.sessions.Get(c.Request.Context(), sid)
		if err != nil {
			if !errors.Is(err, session.ErrNotFound) {
				// Valkey 障害も fail-closed(401)。理由はログにだけ残す。
				log.Printf("httpapi: session get: %v", err)
			}
			abortErr(c, http.StatusUnauthorized, "unauthorized", "ログインしてください")
			return
		}
		grants, err := s.resolver.Grants(c.Request.Context(), cl.ObjectGUID)
		if err != nil {
			log.Printf("httpapi: grants: %v", err)
			abortErr(c, http.StatusInternalServerError, "internal", "権限の解決に失敗しました")
			return
		}
		c.Set(claimsKey, cl)
		c.Set(grantsKey, grants)
		c.Set(sidKey, sid)
		c.Next()
	}
}

func mustClaims(c *gin.Context) *session.Claims {
	return c.MustGet(claimsKey).(*session.Claims)
}

func mustGrants(c *gin.Context) *authz.Grants {
	return c.MustGet(grantsKey).(*authz.Grants)
}

// require enforces (action, min level). false のときレスポンスは書き込み済み。
func (s *Server) require(c *gin.Context, code string, min authz.Level) bool {
	if !mustGrants(c).Allows(code, min) {
		abortErr(c, http.StatusForbidden, "forbidden", "この操作を行う権限がありません")
		return false
	}
	return true
}

func (s *Server) Login(c *gin.Context) {
	var req api.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	id, err := s.authn.Authenticate(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			s.audits.Write(c.Request.Context(), audit.Entry{
				Username: req.Username, ActionCode: authz.ActionAuth, Operation: "login",
				Result: audit.ResultFailure, ErrorCode: "invalid_credentials", ClientIP: c.ClientIP(),
			})
			abortErr(c, http.StatusUnauthorized, "invalid_credentials", "ユーザー名またはパスワードが違います")
			return
		}
		log.Printf("httpapi: ldap: %v", err)
		s.audits.Write(c.Request.Context(), audit.Entry{
			Username: req.Username, ActionCode: authz.ActionAuth, Operation: "login",
			Result: audit.ResultFailure, ErrorCode: "ldap_unavailable", ClientIP: c.ClientIP(),
		})
		abortErr(c, http.StatusBadGateway, "ldap_unavailable", "認証サーバーに接続できません")
		return
	}

	if err := s.resolver.EnsureUser(c.Request.Context(), id); err != nil {
		log.Printf("httpapi: ensure user: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "ユーザー登録に失敗しました")
		return
	}
	grants, err := s.resolver.Grants(c.Request.Context(), id.ObjectGUID)
	if err != nil {
		log.Printf("httpapi: grants: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "権限の解決に失敗しました")
		return
	}

	sid, err := s.sessions.Create(c.Request.Context(), session.Claims{
		ObjectGUID:  id.ObjectGUID,
		Username:    id.Username,
		DisplayName: id.DisplayName,
		Email:       id.Email,
		IP:          c.ClientIP(),
	})
	if err != nil {
		log.Printf("httpapi: session create: %v", err)
		abortErr(c, http.StatusServiceUnavailable, "session_unavailable", "セッションの発行に失敗しました")
		return
	}
	http.SetCookie(c.Writer, s.sessions.Cookie(sid))

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: id.ObjectGUID, Username: id.Username,
		ActionCode: authz.ActionAuth, Operation: "login",
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, meDTO(id.Username, id.DisplayName, id.Email, grants))
}

func (s *Server) Logout(c *gin.Context) {
	cl := mustClaims(c)
	sid := c.MustGet(sidKey).(string)
	if err := s.sessions.Delete(c.Request.Context(), sid, cl.ObjectGUID); err != nil {
		log.Printf("httpapi: logout: %v", err)
	}
	http.SetCookie(c.Writer, s.sessions.ExpiredCookie())
	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionAuth, Operation: "logout",
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

func (s *Server) GetMe(c *gin.Context) {
	cl := mustClaims(c)
	c.JSON(http.StatusOK, meDTO(cl.Username, cl.DisplayName, cl.Email, mustGrants(c)))
}

func meDTO(username, displayName, email string, grants *authz.Grants) api.Me {
	actions := make([]api.GrantedAction, 0, len(grants.Ordered))
	for _, g := range grants.Ordered {
		actions = append(actions, api.GrantedAction{
			Id:        g.ActionID,
			Code:      g.Code,
			Name:      g.Name,
			Icon:      g.Icon,
			AuthLevel: api.AuthLevel(g.Level),
		})
	}
	m := api.Me{Username: username, DisplayName: displayName, Actions: actions}
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
