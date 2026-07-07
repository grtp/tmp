package httpapi

import (
	"net/http"

	"tableadmin/internal/auth"
)

// Router builds the full HTTP handler. Public auth endpoints are open; every
// /api/* data route sits behind the session middleware.
func Router(
	authH *AuthHandler,
	productH *ProductHandler,
	importH *ImportHandler,
	tokens *auth.TokenManager,
	corsOrigin string,
) http.Handler {
	mux := http.NewServeMux()

	// Public.
	mux.HandleFunc("POST /api/auth/login", authH.Login)
	mux.HandleFunc("POST /api/auth/logout", authH.Logout)

	// Protected: wrap a sub-mux in the auth middleware.
	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/auth/me", authH.Me)
	protected.HandleFunc("GET /api/products", productH.List)
	protected.HandleFunc("POST /api/products", productH.Create)
	protected.HandleFunc("PUT /api/products/{id}", productH.Update)
	protected.HandleFunc("DELETE /api/products/{id}", productH.Delete)
	protected.HandleFunc("POST /api/products/import", importH.Import)

	mux.Handle("/api/", tokens.Middleware(protected))

	return cors(corsOrigin, mux)
}

// cors enables the dev SPA on a different port to call the API with cookies.
// In production the SPA is served same-origin behind the reverse proxy, so this
// becomes a no-op (origins match) — but it stays correct either way.
func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
