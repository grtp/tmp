package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	// 本番/dev の .env に実際に現れる形を並べる: コメント,空行,括弧や
	// 記号を含む値(LDAP フィルタやパスワード),引用符付き,export 付き。
	content := `# comment

LDAP_USER_FILTER=(sAMAccountName=%s)
LDAP_BIND_PASSWORD=p@ss!w0rd#1
ADDR=":8080"
export CONN_ENC_KEY='abc=='
ALREADY_SET=from-file
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ALREADY_SET", "from-env")

	if err := LoadEnvFile(path); err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}

	cases := map[string]string{
		"LDAP_USER_FILTER":   "(sAMAccountName=%s)",
		"LDAP_BIND_PASSWORD": "p@ss!w0rd#1",
		"ADDR":               ":8080",
		"CONN_ENC_KEY":       "abc==",
		// 既存の環境変数はファイルより優先される(compose/make の上書き)
		"ALREADY_SET": "from-env",
	}
	for k, want := range cases {
		if got := os.Getenv(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
}

func TestLoadEnvFileEmptyPathIsNoop(t *testing.T) {
	if err := LoadEnvFile(""); err != nil {
		t.Fatalf("LoadEnvFile(\"\"): %v", err)
	}
}

func TestLoadEnvFileMissingIsError(t *testing.T) {
	if err := LoadEnvFile(filepath.Join(t.TempDir(), "nope.env")); err == nil {
		t.Fatal("存在しない ENV_FILE はエラーにしたい(設定ミスに気付けるように)")
	}
}
