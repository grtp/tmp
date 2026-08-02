// Composition Root. 何を使うか(LDAPかMockか)の決定権はこのファイルだけが
// 持つ。他のパッケージはインターフェース越しに依存し,具体実装を知らない。
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
	// 設定ファイル(ENV_FILE)を先に読み込む。dev は deploy/.env.dev,本番は
	// コンテナへマウントした deploy/.env を指す(同じ形・同じパーサ)。
	// 既存の環境変数は上書きしないので compose や make の指定が優先される。
	envFile := os.Getenv("ENV_FILE")
	if err := config.LoadEnvFile(envFile); err != nil {
		fatal("startup failed", "err", err)
	}
	if envFile != "" {
		slog.Info("config file loaded", "path", envFile)
	}

	cfg := config.FromEnv()
	applog.Setup(cfg.LogFormat, cfg.LogLevel)

	// 0) アプリDBのスキーマ(ftool_app_ テーブルの置き場所)。既定 dbo。
	//    以降の全アプリDBクエリがこの設定を参照するため,最初に確定させる。
	if err := appdb.Configure(cfg.AppDBSchema); err != nil {
		fatal("startup failed", "err", err)
	}

	// 1) SQL Server 接続 + 本ツール自身のテーブル(ftool_app_*)の存在確認
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

	// 2) Valkey(セッションストア)。起動時に疎通確認して fail-fast。
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

	// 3) 認証: LDAP or Mock (環境変数スイッチ)
	authenticator := buildAuthenticator(cfg)

	// 4) 認可: objectGUID キーの機能別権限(初回ログインで自動登録)
	resolver := authz.NewResolver(db, cfg.AutoGrantTableMaintView)

	// 5) 接続先管理: ftool_app_connections(パスワードは AES-GCM) + 接続プール
	encKey, err := conn.LoadKey(cfg.ConnEncKey)
	if err != nil {
		fatal("startup failed", "err", err)
	}
	connRepo := conn.NewRepo(db, encKey)
	pools := conn.NewManager(db, connRepo)
	defer pools.Close()

	// 6) メタデータ: ftool_app_managed_tables(アプリDB) + 対象接続のイントロスペクション
	metas := meta.NewService(db, pools, 30*time.Second)

	// 6.5) 監査履歴 detail の 1MB 超過分の退避先(MinIO,任意)。
	//      MINIO_ENDPOINT 未設定ならインターフェースは nil のまま
	//      = 従来通り超過分は破棄する。
	//      注意: *blobstore.Store の nil ポインタをそのままインターフェースに
	//      詰めると "非 nil の nil" になる Go の定番の罠があるため,
	//      未設定時はインターフェース変数自体に触れない。
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

	// 7) HTTP
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
	// X-Forwarded-For を信じてよい相手を限定する。既定(空)は「どのプロキシも
	// 信じない」= 接続元をそのまま client_ip にする。gin の既定は全信頼で,
	// その場合クライアントが自分で送ったヘッダがそのまま監査履歴に載る。
	// 設定値は取り違えても静かに劣化する(全員が前段の IP になる)ため起動時に出す。
	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		fatal("invalid TRUSTED_PROXIES", "err", err)
	}
	if len(cfg.TrustedProxies) == 0 {
		slog.Info("trusted proxies: none (X-Forwarded-For は無視し接続元を使う)")
	} else {
		slog.Info("trusted proxies", "cidrs", strings.Join(cfg.TrustedProxies, ","))
	}

	// アクセスログは自前(リクエスト ID の採番と付与を兼ねる)。
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

// fatal は起動時の致命的エラー。slog へ出してから終了する
// (log.Fatalf と違い出力形式が他のログと揃う)。
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
