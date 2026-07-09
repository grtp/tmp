package store

import "fmt"

// ---- リクエスト/レスポンス(api/openapi.yaml を写した型) ----
// httpapi はこの型で直接 JSON バインドする。生成モデルを使わないのは、
// ボディ形状の契約は OpenAPI 側にあり、Go の生成型の細部(ポインタ有無)に
// ハンドラを結合させないため。

type ListParams struct {
	Limit   int
	Offset  int
	Q       string
	OrderBy string
	Order   string // "asc" | "desc"
}

type RowPage struct {
	Rows   []map[string]any `json:"rows"`
	Total  int              `json:"total"`
	Limit  int              `json:"limit"`
	Offset int              `json:"offset"`
}

type BatchUpdate struct {
	Key        map[string]any `json:"key"`
	Changes    map[string]any `json:"changes"`
	RowVersion string         `json:"rowVersion"`
}

type BatchDelete struct {
	Key        map[string]any `json:"key"`
	RowVersion string         `json:"rowVersion"`
}

type BatchRequest struct {
	Inserts []map[string]any `json:"inserts"`
	Updates []BatchUpdate    `json:"updates"`
	Deletes []BatchDelete    `json:"deletes"`
}

type BatchResult struct {
	Inserted     int              `json:"inserted"`
	Updated      int              `json:"updated"`
	Deleted      int              `json:"deleted"`
	InsertedKeys []map[string]any `json:"insertedKeys,omitempty"`
}

// ---- 型付きエラー(httpapi が HTTP ステータスへ写像する) ----

// ValidationError -> 400 validation_failed
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func validationf(format string, a ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, a...)}
}

// OpError -> 409 conflict。バッチ内のどの操作が原因かを保持する。
// Reason は OpenAPI の BatchError.details.reason と一致させる。
type OpError struct {
	Op     string // "insert" | "update" | "delete"
	Index  int    // リクエスト配列内の位置(0始まり)
	Reason string // "constraint_violation" | "row_version_mismatch" | "not_found" | "validation"
	Msg    string
}

func (e *OpError) Error() string {
	return fmt.Sprintf("%s[%d] %s: %s", e.Op, e.Index, e.Reason, e.Msg)
}
