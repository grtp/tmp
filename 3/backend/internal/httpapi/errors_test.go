package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"f-tool/internal/conn"
	"f-tool/internal/repo"
	"f-tool/internal/store"
)

func init() { gin.SetMode(gin.TestMode) }

// writeStoreError/writeRepoError はエラーの型で応答ステータスと
// コードを決める分岐そのもの。ここを間違えると,例えば行編集の
// 楽観ロック衝突(本来 409)が 500 に化けて利用者に原因が伝わらない。

func do(t *testing.T, f func(c *gin.Context)) (status int, body map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	f(c)
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("response body is not JSON: %s", w.Body.String())
		}
	}
	return w.Code, body
}

func TestWriteStoreError(t *testing.T) {
	s := &Server{}

	t.Run("ValidationError -> 400", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeStoreError(c, &store.ValidationError{Msg: "列 x は不正です"})
		})
		if status != 400 {
			t.Errorf("status = %d, want 400", status)
		}
		if body["code"] != "validation_failed" {
			t.Errorf("code = %v, want validation_failed", body["code"])
		}
	})

	t.Run("OpError -> 409 with details", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeStoreError(c, &store.OpError{Op: "update", Index: 2, Reason: "row_version_mismatch", Msg: "古いバージョンです"})
		})
		if status != 409 {
			t.Errorf("status = %d, want 409", status)
		}
		if body["code"] != "conflict" {
			t.Errorf("code = %v, want conflict", body["code"])
		}
		details, ok := body["details"].(map[string]any)
		if !ok {
			t.Fatalf("details が無い、または形式が不正: %v", body["details"])
		}
		if details["operation"] != "update" || details["reason"] != "row_version_mismatch" {
			t.Errorf("details = %v", details)
		}
	})

	t.Run("接続無効(ErrDisabled) -> 502", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeStoreError(c, conn.ErrDisabled)
		})
		if status != 502 {
			t.Errorf("status = %d, want 502", status)
		}
		if body["code"] != "connection_unavailable" {
			t.Errorf("code = %v, want connection_unavailable", body["code"])
		}
	})

	t.Run("接続到達不能 -> 502", func(t *testing.T) {
		status, _ := do(t, func(c *gin.Context) {
			s.writeStoreError(c, conn.ErrDecrypt)
		})
		if status != 502 {
			t.Errorf("status = %d, want 502", status)
		}
	})

	t.Run("未分類のエラー -> 500", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeStoreError(c, errors.New("boom"))
		})
		if status != 500 {
			t.Errorf("status = %d, want 500", status)
		}
		if body["code"] != "internal" {
			t.Errorf("code = %v, want internal", body["code"])
		}
		// 生のエラー文字列("boom")を利用者へ返してはいけない
		// (内部実装の手がかりを与えるため)。
		if msg, _ := body["message"].(string); msg == "boom" {
			t.Error("内部エラーの原文をそのまま message に出してはいけない")
		}
	})

	t.Run("ラップされた ValidationError も判定できる", func(t *testing.T) {
		status, _ := do(t, func(c *gin.Context) {
			s.writeStoreError(c, fmt.Errorf("wrap: %w", &store.ValidationError{Msg: "x"}))
		})
		if status != 400 {
			t.Errorf("status = %d, want 400(errors.As でラップを剥がせているか)", status)
		}
	})
}

func TestWriteRepoError(t *testing.T) {
	s := &Server{}

	t.Run("ErrNotFound -> 404", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeRepoError(c, repo.ErrNotFound, "取得に失敗しました")
		})
		if status != 404 {
			t.Errorf("status = %d, want 404", status)
		}
		if body["code"] != "not_found" {
			t.Errorf("code = %v, want not_found", body["code"])
		}
	})

	t.Run("ErrConflict -> 409 (エラー文自体を message に使う)", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeRepoError(c, fmt.Errorf("%w: 重複しています", repo.ErrConflict), "更新に失敗しました")
		})
		if status != 409 {
			t.Errorf("status = %d, want 409", status)
		}
		if body["code"] != "conflict" {
			t.Errorf("code = %v, want conflict", body["code"])
		}
	})

	t.Run("未分類のエラー -> 500,fallback文言を使う", func(t *testing.T) {
		status, body := do(t, func(c *gin.Context) {
			s.writeRepoError(c, errors.New("db exploded"), "更新に失敗しました")
		})
		if status != 500 {
			t.Errorf("status = %d, want 500", status)
		}
		if body["message"] != "更新に失敗しました" {
			t.Errorf("message = %v, want fallback text (原文を漏らさない)", body["message"])
		}
	})
}
