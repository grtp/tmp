package admin

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// summarizeDetail は detail(JSON) から人間可読の日本語要約を作る。
// CSV を Excel でそのまま開いても内容が掴めるようにするのが目的で、
// 厳密さより読みやすさを優先する。未知の形は空文字(detail 列で補完)。
func summarizeDetail(operation, detail string) string {
	if detail == "" {
		return ""
	}
	var d map[string]any
	if err := json.Unmarshal([]byte(detail), &d); err != nil {
		return ""
	}

	num := func(key string) (int, bool) {
		v, ok := d[key].(float64)
		return int(v), ok
	}
	str := func(key string) string {
		s, _ := d[key].(string)
		return s
	}

	switch {
	case operation == "rows.batch":
		var parts []string
		if n, ok := num("inserted"); ok && n > 0 {
			parts = append(parts, fmt.Sprintf("追加%d件", n))
		}
		if n, ok := num("updated"); ok && n > 0 {
			parts = append(parts, fmt.Sprintf("更新%d件", n))
		}
		if n, ok := num("deleted"); ok && n > 0 {
			parts = append(parts, fmt.Sprintf("削除%d件", n))
		}
		// 失敗時は要求件数のキーになる(inserts/updates/deletes は配列)。
		if len(parts) == 0 {
			for key, label := range map[string]string{"inserts": "追加", "updates": "更新", "deletes": "削除"} {
				if arr, ok := d[key].([]any); ok && len(arr) > 0 {
					parts = append(parts, fmt.Sprintf("%s%d件", label, len(arr)))
				}
			}
			sort.Strings(parts)
		}
		if errText := str("error"); errText != "" {
			parts = append(parts, "エラー: "+truncateRunes(errText, 60))
		}
		return strings.Join(parts, "・")

	case operation == "rows.export" || operation == "history.export":
		if n, ok := num("rows"); ok {
			return fmt.Sprintf("%d件を出力", n)
		}

	case strings.HasPrefix(operation, "dash-template."):
		name := str("name")
		if name == "" {
			if id, ok := num("id"); ok {
				name = fmt.Sprintf("id=%d", id)
			}
		}
		if n, ok := num("count"); ok {
			return fmt.Sprintf("項目%d件を設定", n)
		}
		return name

	case strings.HasPrefix(operation, "managed-table."):
		if name := str("displayName"); name != "" {
			return name
		}

	case strings.HasPrefix(operation, "user-link."):
		if url := str("url"); url != "" {
			return truncateRunes(url, 80)
		}
	}
	return ""
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
