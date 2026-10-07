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

const maxDetailBytes = 1 << 20

const overflowKeyPrefix = "audit-overflow/"

type Entry struct {
	ObjectGUID adguid.GUID
	Username   string
	ActionCode string
	Operation  string
	Target     string
	Detail     any
	Result     string
	ErrorCode  string
	ClientIP   string
}

type BlobStore interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
}

type Recorder struct {
	db        *sql.DB
	blobStore BlobStore
}

func NewRecorder(db *sql.DB, blobStore BlobStore) *Recorder {
	return &Recorder{db: db, blobStore: blobStore}
}

func (r *Recorder) Write(ctx context.Context, e Entry) {
	var detail any
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

		applog.From(ctx).Error("audit write failed", "op", e.Operation, "user", e.Username, "err", err)
	}
}

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
