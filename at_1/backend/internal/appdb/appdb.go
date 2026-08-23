package appdb

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	schema = "dbo"
	prefix = "dbo."
)

var schemaRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func Configure(s string) error {
	if s == "" || s == "dbo" {
		schema, prefix = "dbo", "dbo."
		return nil
	}
	if !schemaRe.MatchString(s) {
		return fmt.Errorf("appdb: APP_DB_SCHEMA %q が不正です(英数字と _ のみ)", s)
	}
	schema = s
	prefix = quoteIdent(s) + "."
	return nil
}

func Schema() string { return schema }

func Q(sql string) string {
	if prefix == "dbo." {
		return sql
	}
	return strings.ReplaceAll(sql, "dbo.", prefix)
}

func quoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}
