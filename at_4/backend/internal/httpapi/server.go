package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/audit"
	"f-tool/internal/auth"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
	"f-tool/internal/pwchange"
	"f-tool/internal/repo"
	"f-tool/internal/session"
	"f-tool/internal/store"
)

const (
	claimsKey         = "session.claims"
	grantsKey         = "session.grants"
	resourceGrantsKey = "session.resourceGrants"
	sidKey            = "session.sid"
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

	pwchange *pwchange.Service

	db *sql.DB

	blobs BlobGetter
}

type BlobGetter interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

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
	Pwchange *pwchange.Service
	Blobs    BlobGetter
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
		pwchange: d.Pwchange,
		db:       d.DB,
		blobs:    d.Blobs,
	}
}

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

				applog.From(c.Request.Context()).Error("session get failed", "err", err)
			}
			abortErr(c, http.StatusUnauthorized, "unauthorized", "ログインしてください")
			return
		}

		groups, err := s.resolver.GroupClosure(c.Request.Context(), cl.ObjectGUID)
		if err != nil {
			internalError(c, "group closure", err, "権限の解決に失敗しました")
			return
		}
		grants, err := s.resolver.Grants(c.Request.Context(), cl.ObjectGUID, groups)
		if err != nil {
			internalError(c, "grants", err, "権限の解決に失敗しました")
			return
		}
		resourceGrants, err := s.resolver.ResourceGrants(c.Request.Context(), cl.ObjectGUID, groups)
		if err != nil {
			internalError(c, "resource grants", err, "権限の解決に失敗しました")
			return
		}
		c.Set(claimsKey, cl)
		c.Set(grantsKey, grants)
		c.Set(resourceGrantsKey, resourceGrants)
		c.Set(sidKey, sid)
		c.Next()
	}
}

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := applog.NewRequestID()
		c.Request = c.Request.WithContext(applog.WithRequestID(c.Request.Context(), id))
		c.Writer.Header().Set("X-Request-Id", id)

		start := time.Now()
		c.Next()

		lg := applog.From(c.Request.Context()).With(
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", c.ClientIP(),
		)
		switch {
		case c.Writer.Status() >= 500:
			lg.Error("request")
		case c.Writer.Status() >= 400:
			lg.Warn("request")
		default:
			lg.Info("request")
		}
	}
}

func mustClaims(c *gin.Context) *session.Claims {
	return c.MustGet(claimsKey).(*session.Claims)
}

func mustGrants(c *gin.Context) *authz.Grants {
	return c.MustGet(grantsKey).(*authz.Grants)
}

func mustResourceGrants(c *gin.Context) *authz.ResourceGrants {
	return c.MustGet(resourceGrantsKey).(*authz.ResourceGrants)
}

func (s *Server) require(c *gin.Context, code string, min authz.Level) bool {
	if !mustGrants(c).Allows(code, min) {
		abortErr(c, http.StatusForbidden, "forbidden", "この操作を行う権限がありません")
		return false
	}
	return true
}

func featureAdmin(c *gin.Context, code string) bool {
	return mustGrants(c).Allows(code, authz.LevelAdmin)
}

func (s *Server) canAccessTable(c *gin.Context, tableID int, min authz.ResourceLevel) bool {
	if featureAdmin(c, authz.ActionTables) {
		return true
	}
	return mustResourceGrants(c).AllowsTable(tableID, min)
}

func (s *Server) lockoutGuard(c *gin.Context) repo.TxGuard {
	actor := mustClaims(c).ObjectGUID
	return func(ctx context.Context, tx *sql.Tx) error {
		ok, err := s.resolver.HasSettingsAdminOn(ctx, tx, actor)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("%w: この操作で自分自身の設定管理(admin)権限が失われるため実行できません", repo.ErrConflict)
		}
		return nil
	}
}

func abortErr(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, api.Error{
		Code:    api.ErrorCode(code),
		Message: msg,
	})
}

func ptr[T any](v T) *T { return &v }
