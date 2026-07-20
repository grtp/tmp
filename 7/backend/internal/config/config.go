// Package config は全ての実行時設定を環境変数から読む。
// 同一バイナリを dev / prod で無変更のまま動かすため。
package config

import (
	"os"
	"strconv"
)

type Config struct {
	Addr       string
	CORSOrigin string // dev(ng serve)専用。本番はnginx同一オリジンのため未使用。

	// --- SQL Server ---
	MSSQLDSN string // "sqlserver://user:pass@host:1433?database=ftool"
	// AppDBSchema: 本ツール自身のテーブル(app_*)を置くスキーマ。
	// 既定は dbo。DB 側の都合で専用スキーマが割り当てられる場合に変更する
	// (initdb は同じスキーマ名で実行しておくこと)。
	AppDBSchema string

	// --- LDAP / Active Directory ---
	LDAPURL          string
	LDAPBaseDN       string
	LDAPUserFilter   string
	LDAPBindDN       string
	LDAPBindPassword string
	LDAPStartTLS     bool
	// 属性マップ: 本番AD と開発OpenLDAP の差を吸収する。
	//   AD:       objectGUID(バイナリ) / sAMAccountName
	//   OpenLDAP: entryUUID(テキスト)  / uid
	LDAPAttrGUID        string
	LDAPAttrUsername    string
	LDAPAttrDisplayName string
	LDAPAttrMail        string
	LDAPGUIDFormat      string // "ad-binary" | "uuid-string"

	// --- Mock (dev) ---
	LDAPMock     bool
	LDAPMockUser string
	LDAPMockPass string

	// --- セッション(Valkey。env 名は互換のため REDIS_* のまま) ---
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	SessionTTLMin int
	CookieName    string
	CookieSecure  bool

	// --- Authorization ---
	// 初回ログイン時に table-maint:user を自動付与する。
	// false だと admin が権限を付与するまでダッシュボードに何も出ない。
	AutoGrantTableMaintView bool

	// --- 接続先パスワードの暗号鍵 (base64 32bytes, `openssl rand -base64 32`) ---
	ConnEncKey string

	// --- 監査履歴の detail 退避先(MinIO，任意) ---
	// MinioEndpoint が空なら退避機能そのものを無効化する(既存の
	// truncate-and-discard 挙動のまま)。ブラウザには直接触らせない
	// (backend が Put/Get する。§8章 運用手順書参照)。
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool
}

func FromEnv() Config {
	return Config{
		Addr:       env("ADDR", ":8080"),
		CORSOrigin: env("CORS_ORIGIN", "http://localhost:4200"),

		MSSQLDSN:    env("MSSQL_DSN", "sqlserver://sa:Fidev01!@localhost:1433?database=ftool"),
		AppDBSchema: env("APP_DB_SCHEMA", "dbo"),

		LDAPURL:             env("LDAP_URL", "ldap://localhost:389"),
		LDAPBaseDN:          env("LDAP_BASE_DN", "DC=example,DC=local"),
		LDAPUserFilter:      env("LDAP_USER_FILTER", "(sAMAccountName=%s)"),
		LDAPBindDN:          env("LDAP_BIND_DN", ""),
		LDAPBindPassword:    env("LDAP_BIND_PASSWORD", ""),
		LDAPStartTLS:        envBool("LDAP_STARTTLS", false),
		LDAPAttrGUID:        env("LDAP_ATTR_GUID", "objectGUID"),
		LDAPAttrUsername:    env("LDAP_ATTR_USERNAME", "sAMAccountName"),
		LDAPAttrDisplayName: env("LDAP_ATTR_DISPLAY_NAME", "displayName"),
		LDAPAttrMail:        env("LDAP_ATTR_MAIL", "mail"),
		LDAPGUIDFormat:      env("LDAP_GUID_FORMAT", "ad-binary"),

		LDAPMock:     envBool("LDAP_MOCK", false),
		LDAPMockUser: env("LDAP_MOCK_USER", "admin"),
		LDAPMockPass: env("LDAP_MOCK_PASS", "admin"),

		RedisAddr:     env("REDIS_ADDR", "localhost:6379"),
		RedisPassword: env("REDIS_PASSWORD", ""),
		RedisDB:       envInt("REDIS_DB", 0),
		SessionTTLMin: envInt("SESSION_TTL_MIN", 30),
		CookieName:    env("COOKIE_NAME", "sid"),
		CookieSecure:  envBool("COOKIE_SECURE", false),

		AutoGrantTableMaintView: envBool("AUTO_GRANT_TABLE_MAINT_VIEW", true),

		ConnEncKey: env("CONN_ENC_KEY", ""),

		MinioEndpoint:  env("MINIO_ENDPOINT", ""),
		MinioAccessKey: env("MINIO_ACCESS_KEY", ""),
		MinioSecretKey: env("MINIO_SECRET_KEY", ""),
		MinioBucket:    env("MINIO_BUCKET", "audit-overflow"),
		MinioUseSSL:    envBool("MINIO_USE_SSL", false),
	}
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
