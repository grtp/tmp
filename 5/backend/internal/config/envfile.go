package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// 設定ファイル(KEY=VALUE)の読み込み。dev と本番で同じ形のファイルを同じ
// パーサで読むためにアプリ側で持つ(dev は make が ENV_FILE を渡し,本番は
// compose がファイルをマウントして ENV_FILE を渡す)。
//
// 既に設定されている環境変数は上書きしない。これにより
//   - compose の environment(コンテナ構成上固定の値)
//   - make や CI のインライン指定(LDAP_MOCK=true など)
// が常にファイルより優先される。

// LoadEnvFile は path の KEY=VALUE を読み,未設定の環境変数だけを埋める。
// path が空なら何もしない。ファイルが無い場合はエラーを返す(ENV_FILE を
// 明示したのに読めないのは設定ミスのため,呼び出し側で気付けるようにする)。
func LoadEnvFile(path string) error {
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("config: open env file: %w", err)
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for line := 1; sc.Scan(); line++ {
		key, value, ok := parseEnvLine(sc.Text())
		if !ok {
			continue
		}
		if key == "" {
			return fmt.Errorf("config: %s:%d: キーが空です", path, line)
		}
		if _, exists := os.LookupEnv(key); exists {
			continue // 環境変数が優先
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("config: set %s: %w", key, err)
		}
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("config: read env file: %w", err)
	}
	return nil
}

// parseEnvLine は1行を KEY と VALUE に分ける。空行・コメント行は ok=false。
// `export KEY=VALUE` 形式と,値全体を囲む引用符に対応する
// (compose の .env と同じ感覚で書けるようにするため)。
func parseEnvLine(raw string) (key, value string, ok bool) {
	line := strings.TrimSpace(raw)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	k, v, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(k)
	value = strings.TrimSpace(v)
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return key, value, true
}
