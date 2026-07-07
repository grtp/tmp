package auth

import (
	"context"
	"net/http"
)

type ctxKey int

const userCtxKey ctxKey = 0

// Middleware verifies the session cookie and injects the identity into the
// request context. Unauthenticated requests get a clean 401 — the SPA reacts to
// that by redirecting to the login screen.
func (tm *TokenManager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(tm.cookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := tm.parse(c.Value)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		u := &User{
			Username:    claims.Subject,
			DisplayName: claims.DisplayName,
			Email:       claims.Email,
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserFrom extracts the authenticated user placed by Middleware.
func UserFrom(ctx context.Context) (*User, bool) {
	u, ok := ctx.Value(userCtxKey).(*User)
	return u, ok
}
