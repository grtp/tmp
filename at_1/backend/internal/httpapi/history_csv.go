package httpapi

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"f-tool/internal/repo"
)

var jst = time.FixedZone("JST", 9*3600)

func (s *Server) renderHistoryCSV(ctx context.Context, f repo.HistoryFilter, w io.Writer) (int, error) {
	cw := csv.NewWriter(w)
	cw.UseCRLF = true

	if err := cw.Write([]string{
		"occurred_at_jst", "username", "action_code", "operation",
		"target", "summary", "result", "error_code", "client_ip", "detail",
	}); err != nil {
		return 0, err
	}

	n := 0
	err := s.repo.EachHistory(ctx, f, func(e repo.HistoryEntry) error {
		rec := []string{
			e.OccurredAt.In(jst).Format("2006-01-02 15:04:05"),
			e.Username, e.ActionCode, e.Operation, e.Target,
			summarizeDetail(e.Operation, e.Detail),
			e.Result, e.ErrorCode, e.ClientIP, e.Detail,
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
		n++
		return nil
	})
	if err != nil {
		return n, err
	}
	cw.Flush()
	return n, cw.Error()
}

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

	case operation == "home-config.update":
		if after, present := d["after"]; present && after == nil {
			return "設定を削除(既定表示に戻す)"
		}
		return "構成を保存"

	case strings.HasPrefix(operation, "user-link."):

		if code := str("actionCode"); code != "" {
			return "action:" + code
		}
		if name := str("managedTableName"); name != "" {
			return "table:" + truncateRunes(name, 60)
		}
		if kind := str("kind"); kind != "" {
			return kind
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
