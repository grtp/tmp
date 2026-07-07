// Package session issues and verifies login sessions.
//
// Manager が「JWT→Redis に変更できるように」の差し替え点。
// Redis 実装(サーバー側セッション)へ移行するときは RedisManager を
// 追加して main.go の1行を替えるだけにする。Revoke は JWT 実装では
// no-op だが、インターフェースに含めておくことで移行時に HTTP 層の
// 変更を不要にしている。
package session

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"tablemaint/internal/auth/adguid"
)

var ErrInvalidSession = errors.New("invalid session")

// Claims is what a verified session yields.
type Claims struct {
	ObjectGUID  adguid.GUID
	Username    string
	DisplayName string
	Email       string
	Role        string
}

type Manager interface {
	// Issue returns a Set-Cookie value establishing the session.
	Issue(c Claims) (*http.Cookie, error)
	// Verify extracts and validates the session from the request.
	Verify(r *http.Request) (*Claims, error)
	// Expire returns a Set-Cookie value that clears the session cookie.
	Expire() *http.Cookie
	// Revoke invalidates a session server-side. JWT 実装では即時失効は
	// 不可能なため no-op(TTL 満了待ち)。Redis 実装で意味を持つ。
	Revoke(guid adguid.GUID) error
}

// ------------------------------------------------------------------ JWT

type JWTManager struct {
	secret     []byte
	ttl        time.Duration
	cookieName string
	secure     bool
}

func NewJWTManager(secret []byte, ttl time.Duration, cookieName string, secure bool) *JWTManager {
	return &JWTManager{secret: secret, ttl: ttl, cookieName: cookieName, secure: secure}
}

type jwtClaims struct {
	jwt.RegisteredClaims
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
	Role        string `json:"role"`
}

func (m *JWTManager) Issue(c Claims) (*http.Cookie, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   string(c.ObjectGUID),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
		Username:    c.Username,
		DisplayName: c.DisplayName,
		Email:       c.Email,
		Role:        c.Role,
	})
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return nil, fmt.Errorf("session: sign: %w", err)
	}
	return &http.Cookie{
		Name:     m.cookieName,
		Value:    signed,
		Path:     "/",
		HttpOnly: true,
		Secure:   m.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(m.ttl.Seconds()),
	}, nil
}

func (m *JWTManager) Verify(r *http.Request) (*Claims, error) {
	ck, err := r.Cookie(m.cookieName)
	if err != nil {
		return nil, ErrInvalidSession
	}
	var claims jwtClaims
	_, err = jwt.ParseWithClaims(ck.Value, &claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, ErrInvalidSession
	}
	return &Claims{
		ObjectGUID:  adguid.GUID(claims.Subject),
		Username:    claims.Username,
		DisplayName: claims.DisplayName,
		Email:       claims.Email,
		Role:        claims.Role,
	}, nil
}

func (m *JWTManager) Expire() *http.Cookie {
	return &http.Cookie{
		Name:     m.cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   m.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
}

// Revoke is a no-op for stateless JWT (documented tradeoff: role changes
// take effect on next login or TTL expiry). RedisManager will implement
// real revocation.
func (m *JWTManager) Revoke(adguid.GUID) error { return nil }
