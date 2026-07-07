package httpapi

import (
	"errors"
	"net/http"

	"tableadmin/internal/auth"
)

type AuthHandler struct {
	ldap   auth.Authenticator
	tokens *auth.TokenManager
}

func NewAuthHandler(ldap auth.Authenticator, tokens *auth.TokenManager) *AuthHandler {
	return &AuthHandler{ldap: ldap, tokens: tokens}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Login verifies credentials against LDAP and, on success, sets the session
// cookie. The response body carries the user profile so the SPA can show "logged
// in as ..." without a second round-trip.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.ldap.Authenticate(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeErr(w, http.StatusUnauthorized, "ユーザー名またはパスワードが正しくありません")
			return
		}
		// Directory unreachable / misconfigured — distinct from bad password.
		writeErr(w, http.StatusBadGateway, "認証サーバーに接続できません")
		return
	}

	if err := h.tokens.SetCookie(w, user); err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to issue session")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	h.tokens.ClearCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Me echoes the identity carried by the session cookie; the SPA calls it on
// load to decide whether to show the app or the login screen.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFrom(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, user)
}
