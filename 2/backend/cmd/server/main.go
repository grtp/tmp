// Composition Root. 何を使うか(LDAPかMockか、JWTかRedisか)の決定権は
// このファイルだけが持つ。他のパッケージはインターフェース越しに
// 依存し、具体実装を知らない。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	api "tablemaint/gen/api"
	"tablemaint/internal/auth"
	"tablemaint/internal/auth/roles"
	"tablemaint/internal/auth/session"
	"tablemaint/internal/config"
	"tablemaint/internal/httpapi"
	"tablemaint/internal/store"
	"tablemaint/meta"
)

func main() {
	cfg := config.FromEnv()

	// 1) メタデータ: 埋め込みYAMLのロード + 構造検証(失敗 = 起動しない)
	registry, err := meta.Load()
	if err != nil {
		log.Fatalf("meta: %v", err)
	}
	log.Printf("meta: loaded %d table definition(s)", len(registry.All()))

	// 2) SQL Server 接続 + INFORMATION_SCHEMA 突合
	db, err := store.Open(cfg.MSSQLDSN)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer db.Close()

	if cfg.SkipSchemaVerify {
		log.Println("⚠️  SKIP_SCHEMA_VERIFY=true: 定義と実DBの突合を省略(開発初期のみ)")
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := meta.VerifyAgainstDB(ctx, db, registry); err != nil {
			cancel()
			log.Fatalf("schema verify: %v", err)
		}
		cancel()
	}

	// 3) 認証: LDAP or Mock (環境変数スイッチ)
	authenticator := buildAuthenticator(cfg)

	// 4) 認可: objectGUID キーの権限テーブル(初回ログインで自動 user 登録)
	resolver := roles.NewMSSQLResolver(db)

	// 5) セッション: 当面JWT。Redis化はここを RedisManager に替えるだけ。
	var sessions session.Manager = session.NewJWTManager(
		cfg.JWTSecret,
		time.Duration(cfg.TokenTTLMin)*time.Minute,
		cfg.CookieName,
		cfg.CookieSecure,
	)

	// 6) HTTP
	srv := httpapi.New(registry, store.NewTableStore(db), authenticator, resolver, sessions)

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.GET("/healthz", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	api.RegisterHandlersWithOptions(r, srv, api.GinServerOptions{
		BaseURL:     "/api/v1",
		Middlewares: []api.MiddlewareFunc{api.MiddlewareFunc(srv.AuthMiddleware())},
	})

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("listening on %s", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Println("bye")
}

func buildAuthenticator(cfg config.Config) auth.Authenticator {
	if cfg.LDAPMock {
		log.Println("⚠️  LDAP_MOCK=true: using mock authenticator (dev only)")
		return &auth.MockAuthenticator{
			Username: cfg.LDAPMockUser,
			Password: cfg.LDAPMockPass,
		}
	}
	return auth.NewLDAPAuthenticator(auth.LDAPConfig{
		URL:          cfg.LDAPURL,
		BaseDN:       cfg.LDAPBaseDN,
		UserFilter:   cfg.LDAPUserFilter,
		BindDN:       cfg.LDAPBindDN,
		BindPassword: cfg.LDAPBindPassword,
		StartTLS:     cfg.LDAPStartTLS,
	})
}
