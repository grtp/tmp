package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenManager issues and verifies the session JWT. The token is the only thing
// that flows on each request after login, so authorization stays stateless: the
// directory is hit once at login, never again per request.
type TokenManager struct {
	secret []byte
	ttl    time.Duration

	cookieName   string
	cookieSecure bool
}

func NewTokenManager(secret []byte, ttl time.Duration, cookieName string, cookieSecure bool) *TokenManager {
	return &TokenManager{secret: secret, ttl: ttl, cookieName: cookieName, cookieSecure: cookieSecure}
}

type Claims struct {
	DisplayName string `json:"name"`
	Email       string `json:"email"`
	jwt.RegisteredClaims
}

func (tm *TokenManager) issue(u *User) (string, time.Time, error) {
	exp := time.Now().Add(tm.ttl)
	claims := Claims{
		DisplayName: u.DisplayName,
		Email:       u.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.Username,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(tm.secret)
	return signed, exp, err
}

func (tm *TokenManager) parse(raw string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return tm.secret, nil
	})
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// SetCookie writes the session token as an httpOnly cookie. httpOnly means the
// token is invisible to JavaScript, which removes the usual SPA risk of token
// theft via XSS. SameSite=Lax is enough CSRF protection here because all
// mutating endpoints are same-origin (served behind the same reverse proxy).
func (tm *TokenManager) SetCookie(w http.ResponseWriter, u *User) error {
	token, exp, err := tm.issue(u)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     tm.cookieName,
		Value:    token,
		Path:     "/",
		Expires:  exp,
		HttpOnly: true,
		Secure:   tm.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func (tm *TokenManager) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     tm.cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   tm.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (tm *TokenManager) CookieName() string { return tm.cookieName }
