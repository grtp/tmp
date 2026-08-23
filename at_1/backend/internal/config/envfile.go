package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

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
			continue
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
