// Package audit writes every operation (login/logout, row batches,
// settings changes) to app_operation_history.
//
// 履歴の書き込み失敗で業務操作を失敗させない: エラーはログに残すのみ。
// 逆に、業務トランザクションがロールバックされても失敗の事実は履歴に残す
// (Write は業務 Tx の外で呼ばれる)。
package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"

	"tablemaint/internal/auth/adguid"

	"tablemaint/internal/appdb"
)

const (
	ResultSuccess = "success"
	ResultFailure = "failure"
)

// detail JSON の上限。巨大なバッチで履歴テーブルを溢れさせない。
const maxDetailBytes = 1 << 20 // 1MB

type Entry struct {
	ObjectGUID adguid.GUID // "" = 不明(認証失敗など)
	Username   string
	ActionCode string // "auth" | "table-maint" | "settings"
	Operation  string // "login" | "rows.batch" | "managed-table.create" ...
	Target     string
	Detail     any // JSON 化される。nil = なし
	Result     string
	ErrorCode  string
	ClientIP   string
}

type Recorder struct{ db *sql.DB }

func NewRecorder(db *sql.DB) *Recorder { return &Recorder{db: db} }

func (r *Recorder) Write(ctx context.Context, e Entry) {
	var detail any // nil -> NULL
	if e.Detail != nil {
		b, err := json.Marshal(e.Detail)
		if err != nil {
			log.Printf("audit: marshal detail: %v", err)
			b = []byte(`{"error":"detail marshal failed"}`)
		}
		if len(b) > maxDetailBytes {
			b = []byte(`{"truncated":true,"reason":"detail exceeds 1MB"}`)
		}
		detail = string(b)
	}

	var guid any
	if e.ObjectGUID != "" {
		guid = string(e.ObjectGUID)
	}

	_, err := r.db.ExecContext(ctx, appdb.Q(`
		INSERT INTO dbo.app_operation_history
			(object_guid, username, action_code, operation, target, detail, result, error_code, client_ip)
		VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)`),
		guid, e.Username, e.ActionCode, e.Operation,
		nullIfEmpty(e.Target), detail, e.Result, nullIfEmpty(e.ErrorCode), nullIfEmpty(e.ClientIP))
	if err != nil {
		// 監査は best-effort。ここで 500 にすると履歴DBの不調が全操作を止める。
		log.Printf("audit: write failed (op=%s user=%s): %v", e.Operation, e.Username, err)
	}
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
