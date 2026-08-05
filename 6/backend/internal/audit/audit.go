// Package audit は全操作(ログイン/ログアウト,行バッチ,設定変更)を
// ftool_app_operation_history へ記録する。
//
// 履歴の書き込み失敗で業務操作を失敗させない: エラーはログに残すのみ。
// 逆に,業務トランザクションがロールバックされても失敗の事実は履歴に残す
// (Write は業務 Tx の外で呼ばれる)。
//
// detail が 1MB を超える場合,BlobStore が設定されていれば全文を
// オブジェクトストレージ(MinIO)へ退避し(claim check パターン),
// detail 列には {"truncated":true,"overflowKey":"<uuid>"} という
// 参照だけを残す。BlobStore 未設定時・退避自体が失敗した時は,
// 従来通り中身を破棄したプレースホルダのみを残す(監査は best-effort
// なので,この退避処理自体の失敗も業務操作を止める理由にはしない)。
package audit

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"

	"f-tool/internal/auth/adguid"

	"f-tool/internal/appdb"
	"f-tool/internal/applog"
)

const (
	ResultSuccess = "success"
	ResultFailure = "failure"
)

// detail JSON の上限。超過分は BlobStore があれば退避,無ければ破棄する。
const maxDetailBytes = 1 << 20 // 1MB

// overflowKeyPrefix は BlobStore 上のオブジェクトキーの接頭辞。
// 将来のライフサイクルルール(保持期間切れの自動削除)設定を見据えた分離。
const overflowKeyPrefix = "audit-overflow/"

type Entry struct {
	ObjectGUID adguid.GUID // "" = 不明(認証失敗など)
	Username   string
	ActionCode string // "auth" | "tables" | "settings"
	Operation  string // "login" | "rows.batch" | "managed-table.create" ...
	Target     string
	Detail     any // JSON 化される。nil = なし
	Result     string
	ErrorCode  string
	ClientIP   string
}

// BlobStore は overflow 退避の書き込み側インターフェース(blobstore.Store が実装)。
// 書き込み(Put)しか要求しない: 読み出しは httpapi 側が別インターフェース
// (BlobGetter)で受けており,テストもしやすい。
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
}

type Recorder struct {
	db        *sql.DB
	blobStore BlobStore // nil = 退避機能なし(従来通り破棄)
}

// NewRecorder returns a Recorder. blobStore は nil を渡してよい
// (detail 1MB 超過分の退避機能を使わない構成)。
func NewRecorder(db *sql.DB, blobStore BlobStore) *Recorder {
	return &Recorder{db: db, blobStore: blobStore}
}

// Write は1件を記録する。呼び出し元を失敗させることはない。
// 失敗はログのみ(パッケージコメントの best-effort 方針)。業務 Tx の外で呼ぶこと。
func (r *Recorder) Write(ctx context.Context, e Entry) {
	var detail any // nil -> NULL
	if e.Detail != nil {
		b, err := json.Marshal(e.Detail)
		if err != nil {
			applog.From(ctx).Error("audit marshal detail failed", "err", err)
			b = []byte(`{"error":"detail marshal failed"}`)
		}
		if len(b) > maxDetailBytes {
			b = r.overflow(ctx, b)
		}
		detail = string(b)
	}

	var guid any
	if e.ObjectGUID != "" {
		guid = string(e.ObjectGUID)
	}

	_, err := r.db.ExecContext(ctx, appdb.Q(`
		INSERT INTO dbo.ftool_app_operation_history
			(object_guid, username, action_code, operation, target, detail, result, error_code, client_ip)
		VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)`),
		guid, e.Username, e.ActionCode, e.Operation,
		nullIfEmpty(e.Target), detail, e.Result, nullIfEmpty(e.ErrorCode), nullIfEmpty(e.ClientIP))
	if err != nil {
		// 監査は best-effort。ここで 500 にすると履歴DBの不調が全操作を止める。
		applog.From(ctx).Error("audit write failed", "op", e.Operation, "user", e.Username, "err", err)
	}
}

// overflow は 1MB を超えた detail の全文を BlobStore へ退避し,
// detail 列に残す軽量なプレースホルダを返す。BlobStore 未設定・退避失敗時は
// 中身を破棄したプレースホルダを返す(監査本体の書き込みは止めない)。
func (r *Recorder) overflow(ctx context.Context, full []byte) []byte {
	if r.blobStore == nil {
		return []byte(`{"truncated":true,"reason":"detail exceeds 1MB"}`)
	}
	key := overflowKeyPrefix + uuid.NewString() + ".json"
	if err := r.blobStore.Put(ctx, key, full, "application/json"); err != nil {
		applog.From(ctx).Error("audit overflow put failed", "err", err)
		return []byte(`{"truncated":true,"reason":"detail exceeds 1MB","overflowError":"failed to store full detail"}`)
	}
	placeholder, err := json.Marshal(map[string]any{
		"truncated":   true,
		"reason":      "detail exceeds 1MB",
		"overflowKey": key,
	})
	if err != nil {
		// 実質発生しない(固定形状のmapなので marshal は失敗しない想定)。
		return []byte(`{"truncated":true,"reason":"detail exceeds 1MB","overflowKey":"` + key + `"}`)
	}
	return placeholder
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
