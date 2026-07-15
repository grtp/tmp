package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/admin"
	"f-tool/internal/audit"
	"f-tool/internal/authz"
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

	kind := "link"
	if req.Kind != nil && *req.Kind != "" {
		kind = string(*req.Kind)
	}

	l := admin.UserLink{Kind: kind, Name: strings.TrimSpace(req.Name)}
	switch kind {
	case "link":
		if req.Url == nil || !isHTTPURL(*req.Url) {
			abortErr(c, http.StatusBadRequest, "validation_failed", "url は http(s):// で始まる URL を指定してください")
			return
		}
		l.URL = *req.Url
		l.Icon = "external-link"
	case "table":
		// テーブルカードは table-maint の権限が前提(押下先が 403 になるため)。
		if !s.require(c, authz.ActionTableMaint, authz.LevelUser) {
			return
		}
		if req.ManagedTableId == nil {
			abortErr(c, http.StatusBadRequest, "validation_failed", "table カードには managedTableId が必要です")
			return
		}
		m, err := s.repo.GetManagedTable(c.Request.Context(), *req.ManagedTableId)
		if err != nil || !m.Enabled {
			abortErr(c, http.StatusBadRequest, "validation_failed", "指定されたテーブルは登録されていません")
			return
		}
		l.ManagedTableID = m.ID
		l.Icon = "table"
	case "action":
		// 機能へのショートカット: 対象機能の権限を持っていることが前提。
		if req.ActionId == nil {
			abortErr(c, http.StatusBadRequest, "validation_failed", "action カードには actionId が必要です")
			return
		}
		a, err := s.repo.GetAction(c.Request.Context(), *req.ActionId)
		if err != nil || !a.Enabled {
			abortErr(c, http.StatusBadRequest, "validation_failed", "指定された機能は存在しないか無効です")
			return
		}
		if !mustGrants(c).Allows(a.Code, authz.LevelUser) {
			abortErr(c, http.StatusForbidden, "forbidden", "この機能の権限がありません")
			return
		}
		l.ActionID = a.ID
		l.Icon = a.Icon
	default:
		abortErr(c, http.StatusBadRequest, "validation_failed", "kind は link / table / action を指定してください")
		return
	}
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
		Detail: gin.H{"id": created.ID, "kind": created.Kind,
			"url": created.URL, "managedTableId": created.ManagedTableID,
			"actionId": created.ActionID},
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
	// テーブルカードの url 書き換えは意味を持たないため拒否する。
	if req.Url != nil {
		if cur, err := s.repo.GetUserLink(c.Request.Context(), cl.ObjectGUID, id); err == nil && cur.Kind == "table" {
			abortErr(c, http.StatusBadRequest, "validation_failed", "テーブルカードに url は設定できません")
			return
		}
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
	out := api.UserLink{
		Id:        l.ID,
		Kind:      api.UserLinkKind(l.Kind),
		Name:      l.Name,
		Icon:      l.Icon,
		SortOrder: l.SortOrder,
	}
	if l.URL != "" {
		out.Url = ptr(l.URL)
	}
	if l.ManagedTableID != 0 {
		out.ManagedTableId = ptr(l.ManagedTableID)
		out.ManagedTableName = ptr(l.ManagedTableName)
	}
	if l.ActionID != 0 {
		out.ActionId = ptr(l.ActionID)
		out.ActionCode = ptr(l.ActionCode)
	}
	return out
}
