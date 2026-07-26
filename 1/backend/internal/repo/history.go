package repo

import (
	"context"
	"fmt"
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

// buildHistoryWhere は QueryHistory / EachHistory 共通の WHERE を組み立てる。
func buildHistoryWhere(f HistoryFilter) (string, []any) {
	var b whereBuilder
	if f.Username != "" {
		b.add(`username LIKE @p%d ESCAPE '\'`, "%"+escapeLike(f.Username)+"%")
	}
	if f.ActionCode != "" {
		b.add("action_code = @p%d", f.ActionCode)
	}
	if f.Target != "" {
		b.add(`target LIKE @p%d ESCAPE '\'`, "%"+escapeLike(f.Target)+"%")
	}
	if f.Operation != "" {
		b.add(`operation LIKE @p%d ESCAPE '\'`, "%"+escapeLike(f.Operation)+"%")
	}
	if f.ClientIP != "" {
		b.add(`client_ip LIKE @p%d ESCAPE '\'`, "%"+escapeLike(f.ClientIP)+"%")
	}
	if f.Result != "" {
		b.add("result = @p%d", f.Result)
	}
	if f.From != nil {
		b.add("occurred_at >= @p%d", *f.From)
	}
	if f.To != nil {
		b.add("occurred_at <= @p%d", *f.To)
	}
	return b.where()
}

func (r *Repo) QueryHistory(ctx context.Context, f HistoryFilter) (*HistoryPage, error) {
	where, args := buildHistoryWhere(f)

	var total int
	if err := r.queryRow(ctx,
		"SELECT COUNT(*) FROM dbo.ftool_app_operation_history"+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("repo: history count: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT id, occurred_at,
		       COALESCE(LOWER(CONVERT(NVARCHAR(36), object_guid)), N''),
		       username, action_code, operation,
		       COALESCE(target, N''), COALESCE(detail, N''), result,
		       COALESCE(error_code, N''), COALESCE(client_ip, N'')
		FROM dbo.ftool_app_operation_history%s
		ORDER BY occurred_at DESC, id DESC
		OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY`, where, len(args)+1, len(args)+2)
	args = append(args, f.Offset, f.Limit)

	rows, err := r.query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("repo: history query: %w", err)
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

// EachHistory はフィルタ一致の全履歴を新しい順にストリームし，
// 1行ごとに fn を呼ぶ。fn がエラーを返した時点で中断してそのエラーを返す。
// ページングなしの全件処理(httpapi の CSV 出力)用。
func (r *Repo) EachHistory(ctx context.Context, f HistoryFilter, fn func(HistoryEntry) error) error {
	where, args := buildHistoryWhere(f)
	query := `
		SELECT id, occurred_at,
		       COALESCE(LOWER(CONVERT(NVARCHAR(36), object_guid)), N''),
		       username, action_code, operation,
		       COALESCE(target, N''), COALESCE(detail, N''), result,
		       COALESCE(error_code, N''), COALESCE(client_ip, N'')
		FROM dbo.ftool_app_operation_history` + where + `
		ORDER BY occurred_at DESC, id DESC`

	rows, err := r.query(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("repo: history stream: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.ObjectGUID, &e.Username,
			&e.ActionCode, &e.Operation, &e.Target, &e.Detail, &e.Result,
			&e.ErrorCode, &e.ClientIP); err != nil {
			return err
		}
		if err := fn(e); err != nil {
			return err
		}
	}
	return rows.Err()
}

// GetHistoryDetail は1行の detail(JSON文字列)だけを返す。
// overflow(1MB超過分のMinIO退避)取得APIが参照先キーを読むために使う。
// 該当行が無ければ sql.ErrNoRows。
func (r *Repo) GetHistoryDetail(ctx context.Context, id int64) (string, error) {
	var detail string
	err := r.queryRow(ctx,
		`SELECT COALESCE(detail, N'') FROM dbo.ftool_app_operation_history WHERE id = @p1`, id).
		Scan(&detail)
	return detail, err
}
