package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	api "f-tool/gen/api"
	"f-tool/internal/appdb"
	"f-tool/internal/applog"
	"f-tool/internal/audit"
	"f-tool/internal/auth"
	"f-tool/internal/authz"
	"f-tool/internal/blobstore"
	"f-tool/internal/config"
	"f-tool/internal/conn"
	"f-tool/internal/httpapi"
	"f-tool/internal/meta"
	"f-tool/internal/repo"
	"f-tool/internal/session"
	"f-tool/internal/store"
)

func main() {

	envFile := os.Getenv("ENV_FILE")
	if err := config.LoadEnvFile(envFile); err != nil {
		fatal("startup failed", "err", err)
	}
	if envFile != "" {
		slog.Info("config file loaded", "path", envFile)
	}

	cfg := config.FromEnv()
	applog.Setup(cfg.LogFormat, cfg.LogLevel)

	if err := appdb.Configure(cfg.AppDBSchema); err != nil {
		fatal("startup failed", "err", err)
	}

	db, err := store.Open(cfg.MSSQLDSN)
	if err != nil {
		fatal("open database failed", "err", err)
	}
	defer db.Close()
	{
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := store.VerifyAppTables(ctx, db)
		cancel()
		if err != nil {
			fatal("startup failed", "err", err)
		}
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	defer rdb.Close()
	{
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := rdb.Ping(ctx).Err()
		cancel()
		if err != nil {
			fatal("redis ping failed", "addr", cfg.RedisAddr, "err", err)
		}
	}
	sessions := session.NewStore(rdb,
		time.Duration(cfg.SessionTTLMin)*time.Minute, cfg.CookieName, cfg.CookieSecure)

	authenticator := buildAuthenticator(cfg)

	resolver := authz.NewResolver(db, cfg.AutoGrantTablesView)

	encKey, err := conn.LoadKey(cfg.ConnEncKey)
	if err != nil {
		fatal("startup failed", "err", err)
	}
	connRepo := conn.NewRepo(db, encKey)
	pools := conn.NewManager(db, connRepo)
	defer pools.Close()

	metas := meta.NewService(db, pools, 30*time.Second)

	var auditBlobs audit.BlobStore
	var httpBlobs httpapi.BlobGetter
	if cfg.MinioEndpoint != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		blobs, err := blobstore.New(ctx, cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey,
			cfg.MinioBucket, cfg.MinioUseSSL)
		cancel()
		if err != nil {
			fatal("blobstore init failed", "err", err)
		}
		auditBlobs = blobs
		httpBlobs = blobs
	}

	srv := httpapi.New(httpapi.Deps{
		DB:       db,
		Metas:    metas,
		Tables:   store.NewTableStore(pools),
		Authn:    authenticator,
		Resolver: resolver,
		Sessions: sessions,
		Repo:     repo.NewRepo(db),
		Audits:   audit.NewRecorder(db, auditBlobs),
		Conns:    connRepo,
		Pools:    pools,
		Blobs:    httpBlobs,
	})

	r := gin.New()

	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		fatal("invalid TRUSTED_PROXIES", "err", err)
	}
	if len(cfg.TrustedProxies) == 0 {
		slog.Info("trusted proxies: none (X-Forwarded-For は無視し接続元を使う)")
	} else {
		slog.Info("trusted proxies", "cidrs", strings.Join(cfg.TrustedProxies, ","))
	}

	r.Use(httpapi.RequestLogger(), gin.Recovery())
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
		slog.Info("listening", "addr", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("http server failed", "err", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		slog.Error("shutdown failed", "err", err)
	}
	slog.Info("bye")
}

func fatal(msg string, args ...any) {
	slog.Error(msg, args...)
	os.Exit(1)
}

func buildAuthenticator(cfg config.Config) auth.Authenticator {
	if cfg.LDAPMock {
		slog.Warn("LDAP_MOCK=true: using mock authenticator (dev only)")
		return &auth.MockAuthenticator{
			Username: cfg.LDAPMockUser,
			Password: cfg.LDAPMockPass,
		}
	}
	return auth.NewLDAPAuthenticator(auth.LDAPConfig{
		URL:             cfg.LDAPURL,
		BaseDN:          cfg.LDAPBaseDN,
		UserFilter:      cfg.LDAPUserFilter,
		BindDN:          cfg.LDAPBindDN,
		BindPassword:    cfg.LDAPBindPassword,
		StartTLS:        cfg.LDAPStartTLS,
		AttrGUID:        cfg.LDAPAttrGUID,
		AttrUsername:    cfg.LDAPAttrUsername,
		AttrDisplayName: cfg.LDAPAttrDisplayName,
		AttrMail:        cfg.LDAPAttrMail,
		GUIDFormat:      auth.GUIDFormat(cfg.LDAPGUIDFormat),
	})
}
