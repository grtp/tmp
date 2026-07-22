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

// 履歴 CSV の描画(列構成・JST 表記・summary 列)は HTTP レスポンスの
// 表現の問題なので httpapi が持つ。repo は EachHistory で行を流すだけ。

var jst = time.FixedZone("JST", 9*3600)

// renderHistoryCSV はフィルタ条件に一致する全履歴を CSV でストリーム出力する。
// 日時は画面表示と同じ JST 表記(列名 occurred_at_jst で明示)。detail は
// JSON 文字列のまま 1 セルに入れる。返り値は出力した行数(監査記録用)。
func (s *Server) renderHistoryCSV(ctx context.Context, f repo.HistoryFilter, w io.Writer) (int, error) {
	cw := csv.NewWriter(w)
	cw.UseCRLF = true
	// summary は detail(JSON) の人間可読要約。Excel でそのまま読む運用向け。
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

// summarizeDetail は detail(JSON) から人間可読の日本語要約を作る。
// CSV を Excel でそのまま開いても内容が掴めるようにするのが目的で，
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
		// データ最小化(2026-07-19): 個人リンクの URL/名前は監査に残さない。
		// kind=action/table は固定オブジェクトへの参照(actionCode/テーブル
		// 表示名)を優先して見せ，kind=link は kind のみ(過去の履歴行には
		// url が残っている可能性があるが，新規に出力はしない)。
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
