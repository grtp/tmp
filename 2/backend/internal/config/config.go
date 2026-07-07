// Package config reads all runtime configuration from the environment
// so the same binary runs unchanged in dev and prod.
package config

import (
	"os"
	"strconv"
)

type Config struct {
	Addr       string
	CORSOrigin string // dev(ng serve)専用。本番はnginx同一オリジンのため未使用。

	// --- SQL Server ---
	MSSQLDSN string // "sqlserver://user:pass@host:1433?database=tablemaint"
	// 起動時の INFORMATION_SCHEMA 突合をスキップする(開発初期のみ true 想定)
	SkipSchemaVerify bool

	// --- LDAP / Active Directory ---
	LDAPURL          string
	LDAPBaseDN       string
	LDAPUserFilter   string
	LDAPBindDN       string
	LDAPBindPassword string
	LDAPStartTLS     bool

	// --- Mock (dev) ---
	LDAPMock     bool
	LDAPMockUser string
	LDAPMockPass string

	// --- Session ---
	JWTSecret    []byte
	CookieName   string
	CookieSecure bool
	TokenTTLMin  int
}

func FromEnv() Config {
	return Config{
		Addr:       env("ADDR", ":8080"),
		CORSOrigin: env("CORS_ORIGIN", "http://localhost:4200"),

		MSSQLDSN:         env("MSSQL_DSN", "sqlserver://sa:DevPassw0rd!@localhost:1433?database=tablemaint"),
		SkipSchemaVerify: envBool("SKIP_SCHEMA_VERIFY", false),

		LDAPURL:          env("LDAP_URL", "ldap://localhost:389"),
		LDAPBaseDN:       env("LDAP_BASE_DN", "DC=example,DC=local"),
		LDAPUserFilter:   env("LDAP_USER_FILTER", "(sAMAccountName=%s)"),
		LDAPBindDN:       env("LDAP_BIND_DN", ""),
		LDAPBindPassword: env("LDAP_BIND_PASSWORD", ""),
		LDAPStartTLS:     envBool("LDAP_STARTTLS", false),

		LDAPMock:     envBool("LDAP_MOCK", false),
		LDAPMockUser: env("LDAP_MOCK_USER", "admin"),
		LDAPMockPass: env("LDAP_MOCK_PASS", "admin"),

		JWTSecret:    []byte(env("JWT_SECRET", "change-me-in-production-please-32bytes")),
		CookieName:   env("COOKIE_NAME", "session"),
		CookieSecure: envBool("COOKIE_SECURE", false),
		TokenTTLMin:  envInt("TOKEN_TTL_MIN", 480),
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
