package config

import (
	"os"
	"strconv"
)

// Config holds all runtime configuration. Everything is read from the
// environment so the same binary can run in dev, staging and prod unchanged.
type Config struct {
	Addr       string // HTTP listen address, e.g. ":8080"
	CORSOrigin string // allowed SPA origin in dev, e.g. "http://localhost:4200"

	// --- LDAP / Active Directory ---
	LDAPURL          string // "ldap://dc.example.local:389" or "ldaps://..."
	LDAPBaseDN       string // "DC=example,DC=local"
	LDAPUserFilter   string // "(sAMAccountName=%s)"
	LDAPBindDN       string // service account DN used to search (optional)
	LDAPBindPassword string
	LDAPStartTLS     bool

	// --- Session token (JWT in an httpOnly cookie) ---
	JWTSecret    []byte
	CookieName   string
	CookieSecure bool // true behind HTTPS (set false only for local http dev)
	TokenTTLMin  int

	// --- Storage ---
	DBPath string

	// --- Mock ---
	LDAPMock     bool
	LDAPMockUser string
	LDAPMockPass string
}

func FromEnv() Config {
	return Config{
		Addr:       env("ADDR", ":8080"),
		CORSOrigin: env("CORS_ORIGIN", "http://localhost:4200"),

		LDAPURL:          env("LDAP_URL", "ldap://localhost:389"),
		LDAPBaseDN:       env("LDAP_BASE_DN", "DC=example,DC=local"),
		LDAPUserFilter:   env("LDAP_USER_FILTER", "(sAMAccountName=%s)"),
		LDAPBindDN:       env("LDAP_BIND_DN", ""),
		LDAPBindPassword: env("LDAP_BIND_PASSWORD", ""),
		LDAPStartTLS:     envBool("LDAP_STARTTLS", false),

		JWTSecret:    []byte(env("JWT_SECRET", "change-me-in-production-please-32bytes")),
		CookieName:   env("COOKIE_NAME", "session"),
		CookieSecure: envBool("COOKIE_SECURE", false),
		TokenTTLMin:  envInt("TOKEN_TTL_MIN", 480), // 8h working day

		DBPath:       env("DB_PATH", "data.db"),
		LDAPMock:     os.Getenv("LDAP_MOCK") == "true",
		LDAPMockUser: env("LDAP_MOCK_USER", "admin"),
		LDAPMockPass: env("LDAP_MOCK_PASS", "admin"),
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
