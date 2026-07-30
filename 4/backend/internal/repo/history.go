package repo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"f-tool/internal/predicate"
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
	// Preds: チップフィルタの述語。列キーは API のフィールド名
	// (username, actionCode, operation, target, clientIp, result, occurredAt)。
	Preds  []predicate.Predicate
	Limit  int
	Offset int
}

// historyPredSpecs は操作履歴のフィルタ可能列(許可リスト)。
// キーは API/フロントのフィールド名,SQL は実列名。
func historyPredSpecs() map[string]predicate.ColumnSpec {
	return map[string]predicate.ColumnSpec{
		"username":   {SQL: "username", Type: predicate.TypeString},
		"actionCode": {SQL: "action_code", Type: predicate.TypeString},
		"operation":  {SQL: "operation", Type: predicate.TypeString},
		"target":     {SQL: "target", Type: predicate.TypeString, Nullable: true},
		"clientIp":   {SQL: "client_ip", Type: predicate.TypeString, Nullable: true},
		"result":     {SQL: "result", Type: predicate.TypeEnum, Enum: []string{"success", "failure"}},
		// occurred_at は UTC 保存・JST 表示のため,日単位フィルタは JST の
		// 1日境界(+9h)で解釈する(旧フィルタ行の挙動を踏襲)。
		"occurredAt": {SQL: "occurred_at", Type: predicate.TypeDateTime, DayOffsetMinutes: 540},
	}
}

type HistoryPage struct {
	Entries []HistoryEntry
	Total   int
	Limit   int
	Offset  int
}

// buildHistoryWhere は QueryHistory / EachHistory 共通の WHERE を組み立てる。
func buildHistoryWhere(f HistoryFilter) (string, []any, error) {
	if len(f.Preds) == 0 {
		return "", nil, nil
	}
	conds, args, err := predicate.Build(historyPredSpecs(), f.Preds, 0)
	if err != nil {
		return "", nil, err
	}
	return " WHERE " + strings.Join(conds, " AND "), args, nil
}

// ValidateHistoryFilter は WHERE を組み立てて検証だけ行う
// (ストリーム系ハンドラがヘッダー送信前に 400 を返すために使う)。
func ValidateHistoryFilter(f HistoryFilter) (string, []any, error) {
	return buildHistoryWhere(f)
}

func (r *Repo) QueryHistory(ctx context.Context, f HistoryFilter) (*HistoryPage, error) {
	where, args, err := buildHistoryWhere(f)
	if err != nil {
		return nil, err
	}

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

// EachHistory はフィルタ一致の全履歴を新しい順にストリームし,
// 1行ごとに fn を呼ぶ。fn がエラーを返した時点で中断してそのエラーを返す。
// ページングなしの全件処理(httpapi の CSV 出力)用。
func (r *Repo) EachHistory(ctx context.Context, f HistoryFilter, fn func(HistoryEntry) error) error {
	where, args, err := buildHistoryWhere(f)
	if err != nil {
		return err
	}
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
