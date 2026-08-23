package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr       string
	CORSOrigin string

	TrustedProxies []string

	LogFormat string
	LogLevel  string

	MSSQLDSN string

	AppDBSchema string

	LDAPURL          string
	LDAPBaseDN       string
	LDAPUserFilter   string
	LDAPBindDN       string
	LDAPBindPassword string
	LDAPStartTLS     bool

	LDAPAttrGUID        string
	LDAPAttrUsername    string
	LDAPAttrDisplayName string
	LDAPAttrMail        string
	LDAPGUIDFormat      string

	LDAPMock     bool
	LDAPMockUser string
	LDAPMockPass string

	RedisAddr     string
	RedisPassword string
	RedisDB       int
	SessionTTLMin int
	CookieName    string
	CookieSecure  bool

	AutoGrantTablesView bool

	ConnEncKey string

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

		TrustedProxies: envList("TRUSTED_PROXIES"),

		LogFormat: env("LOG_FORMAT", "text"),
		LogLevel:  env("LOG_LEVEL", "info"),

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

		AutoGrantTablesView: envBool("AUTO_GRANT_TABLES_VIEW", true),

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

func envList(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if v := strings.TrimSpace(part); v != "" {
			out = append(out, v)
		}
	}
	return out
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
