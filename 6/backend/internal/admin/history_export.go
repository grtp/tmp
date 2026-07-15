package admin

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"time"
)

var jst = time.FixedZone("JST", 9*3600)

// ExportHistoryCSV はフィルタ条件に一致する全履歴を CSV でストリーム出力する。
// 日時は画面表示と同じ JST 表記(列名 occurred_at_jst で明示)。detail は
// JSON 文字列のまま 1 セルに入れる。返り値は出力した行数(監査記録用)。
func (r *Repo) ExportHistoryCSV(ctx context.Context, f HistoryFilter, w io.Writer) (int, error) {
	where, args := buildHistoryWhere(f)
	query := `
		SELECT occurred_at, username, action_code, operation,
		       COALESCE(target, N''), result, COALESCE(error_code, N''),
		       COALESCE(client_ip, N''), COALESCE(detail, N'')
		FROM dbo.app_operation_history` + where + `
		ORDER BY occurred_at DESC, id DESC`

	rows, err := r.query(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("admin: history export: %w", err)
	}
	defer rows.Close()

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
	for rows.Next() {
		var at time.Time
		var username, action, op, target, result, errCode, ip, detail string
		if err := rows.Scan(&at, &username, &action, &op, &target, &result, &errCode, &ip, &detail); err != nil {
			return n, err
		}
		rec := []string{
			at.In(jst).Format("2006-01-02 15:04:05"),
			username, action, op, target, summarizeDetail(op, detail),
			result, errCode, ip, detail,
		}
		if err := cw.Write(rec); err != nil {
			return n, err
		}
		n++
	}
	if err := rows.Err(); err != nil {
		return n, err
	}
	cw.Flush()
	return n, cw.Error()
}
