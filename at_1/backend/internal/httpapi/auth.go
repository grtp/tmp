package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/auth"
	"f-tool/internal/authz"
	"f-tool/internal/session"
)

func (s *Server) Login(c *gin.Context) {
	var req api.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	id, err := s.authn.Authenticate(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			s.auditAsNG(c, "", req.Username, authz.ActionAuth, "login", "",
				nil, "invalid_credentials")
			abortErr(c, http.StatusUnauthorized, "invalid_credentials", "ユーザー名またはパスワードが違います")
			return
		}
		applog.From(c.Request.Context()).Error("ldap authenticate failed", "err", err)
		s.auditAsNG(c, "", req.Username, authz.ActionAuth, "login", "",
			nil, "ldap_unavailable")
		abortErr(c, http.StatusBadGateway, "ldap_unavailable", "認証サーバーに接続できません")
		return
	}

	if err := s.resolver.EnsureUser(c.Request.Context(), id); err != nil {
		internalError(c, "ensure user", err, "ユーザー登録に失敗しました")
		return
	}
	grants, err := s.resolver.Grants(c.Request.Context(), id.ObjectGUID)
	if err != nil {
		internalError(c, "grants", err, "権限の解決に失敗しました")
		return
	}

	sid, err := s.sessions.Create(c.Request.Context(), session.Claims{
		ObjectGUID:  id.ObjectGUID,
		Username:    id.Username,
		DisplayName: id.DisplayName,
		Email:       id.Email,
		IP:          c.ClientIP(),
	})
	if err != nil {
		applog.From(c.Request.Context()).Error("session create failed", "err", err)
		abortErr(c, http.StatusServiceUnavailable, "session_unavailable", "セッションの発行に失敗しました")
		return
	}
	http.SetCookie(c.Writer, s.sessions.Cookie(sid))

	s.auditAsOK(c, id.ObjectGUID, id.Username, authz.ActionAuth, "login", "", nil)
	c.JSON(http.StatusOK, meDTO(id.Username, id.DisplayName, id.Email, grants))
}

func (s *Server) Logout(c *gin.Context) {
	cl := mustClaims(c)
	sid := c.MustGet(sidKey).(string)
	if err := s.sessions.Delete(c.Request.Context(), sid, cl.ObjectGUID); err != nil {
		applog.From(c.Request.Context()).Warn("session delete failed", "err", err)
	}
	http.SetCookie(c.Writer, s.sessions.ExpiredCookie())
	s.auditOK(c, authz.ActionAuth, "logout", "",
		nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) GetMe(c *gin.Context) {
	cl := mustClaims(c)
	c.JSON(http.StatusOK, meDTO(cl.Username, cl.DisplayName, cl.Email, mustGrants(c)))
}

func meDTO(username, displayName, email string, grants *authz.Grants) api.Me {
	actions := make([]api.GrantedAction, 0, len(grants.Ordered))
	for _, g := range grants.Ordered {
		actions = append(actions, api.GrantedAction{
			Id:        g.ActionID,
			Code:      g.Code,
			Name:      g.Name,
			Icon:      g.Icon,
			AuthLevel: api.AuthLevel(g.Level),
		})
	}
	m := api.Me{Username: username, DisplayName: displayName, Actions: actions}
	if email != "" {
		m.Email = ptr(email)
	}
	return m
}
