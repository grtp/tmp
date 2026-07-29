// Package httpapi は oapi-codegen 生成の ServerInterface を実装する
// (gen/api). API 契約は api/openapi.yaml が正であり，このパッケージは
// それに従うだけ。生成コードが無い状態ではコンパイルできないため，
// 先に `make generate` を実行すること。
package httpapi

import (
	"context"
	"database/sql"
	"errors"
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
				applog.From(c.Request.Context()).Error("session get failed", "err", err)
			}
			abortErr(c, http.StatusUnauthorized, "unauthorized", "ログインしてください")
			return
		}
		grants, err := s.resolver.Grants(c.Request.Context(), cl.ObjectGUID)
		if err != nil {
			internalError(c, "grants", err, "権限の解決に失敗しました")
			return
		}
		c.Set(claimsKey, cl)
		c.Set(grantsKey, grants)
		c.Set(sidKey, sid)
		c.Next()
	}
}

// RequestLogger は gin.Logger の代わり。リクエスト ID を採番して context へ
// 載せ,同じ ID をアクセスログとハンドラ内のログの双方に出す
// (1リクエストの流れを後から突き合わせられるようにするため)。
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := applog.NewRequestID()
		c.Request = c.Request.WithContext(applog.WithRequestID(c.Request.Context(), id))
		c.Writer.Header().Set("X-Request-Id", id)

		start := time.Now()
		c.Next()

		// 4xx/5xx は warn 以上にして,平常時のログ量を抑えつつ異常を拾いやすくする。
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

// require enforces (action, min level). false のときレスポンスは書き込み済み。
func (s *Server) require(c *gin.Context, code string, min authz.Level) bool {
	if !mustGrants(c).Allows(code, min) {
		abortErr(c, http.StatusForbidden, "forbidden", "この操作を行う権限がありません")
		return false
	}
	return true
}

func abortErr(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, api.Error{
		Code:    api.ErrorCode(code),
		Message: msg,
	})
}

func ptr[T any](v T) *T { return &v }
