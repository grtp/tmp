package admin

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type HistoryEntry struct {
	ID         int64
	OccurredAt time.Time
	ObjectGUID string // "" = 不明(認証失敗など)
	Username   string
	ActionCode string
	Operation  string
	Target     string
	Detail     string // JSON 文字列("" = なし)
	Result     string
	ErrorCode  string
	ClientIP   string
}

type HistoryFilter struct {
	Username   string
	ActionCode string
	Target     string
	Operation  string
	ClientIP   string
	Result     string
	From       *time.Time
	To         *time.Time
	Limit      int
	Offset     int
}

type HistoryPage struct {
	Entries []HistoryEntry
	Total   int
	Limit   int
	Offset  int
}

// buildHistoryWhere は QueryHistory / ExportHistoryCSV 共通の WHERE を組み立てる。
func buildHistoryWhere(f HistoryFilter) (string, []any) {
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if f.Username != "" {
		add(`username LIKE @p%d ESCAPE '\'`, "%"+escapeLikeAdmin(f.Username)+"%")
	}
	if f.ActionCode != "" {
		add("action_code = @p%d", f.ActionCode)
	}
	if f.Target != "" {
		add(`target LIKE @p%d ESCAPE '\'`, "%"+escapeLikeAdmin(f.Target)+"%")
	}
	if f.Operation != "" {
		add(`operation LIKE @p%d ESCAPE '\'`, "%"+escapeLikeAdmin(f.Operation)+"%")
	}
	if f.ClientIP != "" {
		add(`client_ip LIKE @p%d ESCAPE '\'`, "%"+escapeLikeAdmin(f.ClientIP)+"%")
	}
	if f.Result != "" {
		add("result = @p%d", f.Result)
	}
	if f.From != nil {
		add("occurred_at >= @p%d", *f.From)
	}
	if f.To != nil {
		add("occurred_at <= @p%d", *f.To)
	}
	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

func (r *Repo) QueryHistory(ctx context.Context, f HistoryFilter) (*HistoryPage, error) {
	where, args := buildHistoryWhere(f)

	var total int
	if err := r.queryRow(ctx,
		"SELECT COUNT(*) FROM dbo.app_operation_history"+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin: history count: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT id, occurred_at,
		       COALESCE(LOWER(CONVERT(NVARCHAR(36), object_guid)), N''),
		       username, action_code, operation,
		       COALESCE(target, N''), COALESCE(detail, N''), result,
		       COALESCE(error_code, N''), COALESCE(client_ip, N'')
		FROM dbo.app_operation_history%s
		ORDER BY occurred_at DESC, id DESC
		OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY`, where, len(args)+1, len(args)+2)
	args = append(args, f.Offset, f.Limit)

	rows, err := r.query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("admin: history query: %w", err)
	}
	defer rows.Close()

	page := &HistoryPage{Entries: []HistoryEntry{}, Total: total, Limit: f.Limit, Offset: f.Offset}
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.ObjectGUID, &e.Username,
			&e.ActionCode, &e.Operation, &e.Target, &e.Detail, &e.Result,
			&e.ErrorCode, &e.ClientIP); err != nil {
			return nil, err
		}
		page.Entries = append(page.Entries, e)
	}
	return page, rows.Err()
}
