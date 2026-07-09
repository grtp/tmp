package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "tablemaint/gen/api"
	"tablemaint/internal/admin"
	"tablemaint/internal/audit"
)

// 個人リンクは「自分のダッシュボードのカスタマイズ」なので admin 権限は
// 不要(認証のみ)。全操作が本人の object_guid でスコープされる。

const actionDashboard = "dashboard" // 履歴用の擬似 action code

func (s *Server) ListMyLinks(c *gin.Context) {
	cl := mustClaims(c)
	links, err := s.repo.ListUserLinks(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		s.writeAdminError(c, err, "リンク一覧の取得に失敗しました")
		return
	}
	out := make([]api.UserLink, 0, len(links))
	for _, l := range links {
		out = append(out, userLinkDTO(l))
	}
	c.JSON(http.StatusOK, gin.H{"links": out})
}

func (s *Server) CreateMyLink(c *gin.Context) {
	cl := mustClaims(c)

	var req api.UserLinkCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", "name は必須です")
		return
	}
	if !isHTTPURL(req.Url) {
		abortErr(c, http.StatusBadRequest, "validation_failed", "url は http(s):// で始まる URL を指定してください")
		return
	}

	l := admin.UserLink{Name: strings.TrimSpace(req.Name), URL: req.Url, Icon: "external-link"}
	if req.Icon != nil && *req.Icon != "" {
		l.Icon = *req.Icon
	}
	if req.SortOrder != nil {
		l.SortOrder = *req.SortOrder
	}

	created, err := s.repo.CreateUserLink(c.Request.Context(), cl.ObjectGUID, l)
	if err != nil {
		s.writeAdminError(c, err, "リンクの追加に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: actionDashboard, Operation: "user-link.create",
		Target: "link:" + created.Name,
		Detail: gin.H{"id": created.ID, "url": created.URL},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusCreated, userLinkDTO(*created))
}

func (s *Server) UpdateMyLink(c *gin.Context, id int) {
	cl := mustClaims(c)

	var req api.UserLinkUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if req.Url != nil && !isHTTPURL(*req.Url) {
		abortErr(c, http.StatusBadRequest, "validation_failed", "url は http(s):// で始まる URL を指定してください")
		return
	}

	updated, err := s.repo.UpdateUserLink(c.Request.Context(), cl.ObjectGUID, id,
		req.Name, req.Url, req.Icon, req.SortOrder)
	if err != nil {
		s.writeAdminError(c, err, "リンクの更新に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: actionDashboard, Operation: "user-link.update",
		Target: "link:" + updated.Name,
		Detail: req, Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, userLinkDTO(*updated))
}

func (s *Server) DeleteMyLink(c *gin.Context, id int) {
	cl := mustClaims(c)

	target, err := s.repo.GetUserLink(c.Request.Context(), cl.ObjectGUID, id)
	if err != nil {
		s.writeAdminError(c, err, "リンクの削除に失敗しました")
		return
	}
	if err := s.repo.DeleteUserLink(c.Request.Context(), cl.ObjectGUID, id); err != nil {
		s.writeAdminError(c, err, "リンクの削除に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: actionDashboard, Operation: "user-link.delete",
		Target: "link:" + target.Name,
		Detail: gin.H{"id": id, "url": target.URL},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

func userLinkDTO(l admin.UserLink) api.UserLink {
	return api.UserLink{
		Id:        l.ID,
		Name:      l.Name,
		Url:       l.URL,
		Icon:      l.Icon,
		SortOrder: l.SortOrder,
	}
}
