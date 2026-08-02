package session

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Cookie/ExpiredCookie/SIDFromRequest は Valkey に触れないため,
// クライアントを介さず直接検証できる。ここはセッション奪取(XSS/CSRF)
// への防衛線そのものなので,属性の欠落を確実に検知したい。

func newTestStore(cookieName string, secure bool) *Store {
	return NewStore(nil, 30*time.Minute, cookieName, secure)
}

func TestCookieAttributes(t *testing.T) {
	s := newTestStore("sid", true)
	c := s.Cookie("abc123")

	if c.Name != "sid" {
		t.Errorf("Name = %q, want sid", c.Name)
	}
	if c.Value != "abc123" {
		t.Errorf("Value = %q, want abc123", c.Value)
	}
	if !c.HttpOnly {
		t.Error("HttpOnly must be true(XSS からの sid 窃取を防ぐ)")
	}
	if !c.Secure {
		t.Error("COOKIE_SECURE=true の設定は Cookie にも反映されるべき")
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax(CSRF 対策)", c.SameSite)
	}
	if c.Path != "/" {
		t.Errorf("Path = %q, want /", c.Path)
	}
	if c.MaxAge != 0 {
		t.Errorf("MaxAge = %d, want 0(セッション Cookie。寿命は Valkey TTL が正)", c.MaxAge)
	}
}

func TestCookieSecureFollowsConfig(t *testing.T) {
	s := newTestStore("sid", false)
	if s.Cookie("x").Secure {
		t.Error("COOKIE_SECURE=false の設定では Secure を立てるべきではない(HTTP 環境で Cookie が送られなくなる)")
	}
}

func TestExpiredCookieClearsSession(t *testing.T) {
	s := newTestStore("sid", true)
	c := s.ExpiredCookie()

	if c.Value != "" {
		t.Errorf("Value = %q, want empty", c.Value)
	}
	if c.MaxAge >= 0 {
		t.Errorf("MaxAge = %d, want negative(即時失効)", c.MaxAge)
	}
	// ログアウト時も Cookie 属性(HttpOnly/Secure/SameSite/Path)は
	// 発行時と揃っていないとブラウザが同一 Cookie と見なさず削除できない。
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/" {
		t.Errorf("ExpiredCookie の属性が Cookie() と揃っていない: %+v", c)
	}
}

func TestSIDFromRequest(t *testing.T) {
	s := newTestStore("sid", true)

	withCookie := httptest.NewRequest(http.MethodGet, "/", nil)
	withCookie.AddCookie(&http.Cookie{Name: "sid", Value: "the-sid"})
	if got := s.SIDFromRequest(withCookie); got != "the-sid" {
		t.Errorf("SIDFromRequest = %q, want the-sid", got)
	}

	without := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := s.SIDFromRequest(without); got != "" {
		t.Errorf("Cookie が無いリクエストは空文字を返すはず: got %q", got)
	}
}

func TestSIDFromRequestWrongCookieName(t *testing.T) {
	s := newTestStore("sid", true)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "other", Value: "irrelevant"})
	if got := s.SIDFromRequest(req); got != "" {
		t.Errorf("別名の Cookie を拾ってはいけない: got %q", got)
	}
}
