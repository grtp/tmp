package httpapi

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"f-tool/internal/auth/adguid"
	"f-tool/internal/session"
)

// 監査ヘルパーは認証前(ログイン処理)でも呼ばれうる。claims が無い状態で
// panic すると認証そのものが 500 になるため,空の実行者で返すこと。
// (実際に一度この経路でログインが落ちたため回帰テストとして残す)
func TestActorFromContextWithoutClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	guid, username := actorFromContext(c)
	if guid != "" || username != "" {
		t.Fatalf("claims が無ければ空を返す想定: guid=%q username=%q", guid, username)
	}
}

func TestActorFromContextWithClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(claimsKey, &session.Claims{
		ObjectGUID: adguid.GUID("11111111-2222-3333-4444-555555555555"),
		Username:   "local",
	})

	guid, username := actorFromContext(c)
	if string(guid) != "11111111-2222-3333-4444-555555555555" || username != "local" {
		t.Fatalf("claims の実行者を返す想定: guid=%q username=%q", guid, username)
	}
}
