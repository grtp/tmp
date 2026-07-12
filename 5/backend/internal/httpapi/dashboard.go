package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "tablemaint/gen/api"
	"tablemaint/internal/admin"
	"tablemaint/internal/audit"
	"tablemaint/internal/authz"
)

// ダッシュボードテンプレート: 管理(CRUD/items)は settings:admin、
// 一覧参照(enabled のみ)と自分の選択は認証のみ。

func (s *Server) ListDashTemplates(c *gin.Context, params api.ListDashTemplatesParams) {
	all := params.All != nil && *params.All
	if all && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.repo.ListDashTemplates(c.Request.Context(), all, string(mustClaims(c).ObjectGUID))
	if err != nil {
		log.Printf("httpapi: list dash templates: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "テンプレート一覧の取得に失敗しました")
		return
	}
	out := make([]api.DashTemplate, 0, len(list))
	for _, t := range list {
		out = append(out, dashTemplateDTO(t, false))
	}
	c.JSON(http.StatusOK, gin.H{"templates": out})
}

func (s *Server) GetDashTemplate(c *gin.Context, id int) {
	// 認証のみ: 選択中テンプレートの描画に全ユーザーが使う。
	// 他人の個人テンプレートはリポジトリ側で 404 になる。
	t, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(mustClaims(c).ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレートの取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, dashTemplateDTO(*t, true))
}

func (s *Server) CreateDashTemplate(c *gin.Context) {
	cl := mustClaims(c)

	var req api.DashTemplateCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	// 個人テンプレートは誰でも自分用に作れる。配布は settings:admin のみ。
	personal := req.Personal != nil && *req.Personal
	if !personal && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", "name は必須です")
		return
	}

	t := admin.DashTemplate{Name: strings.TrimSpace(req.Name), Enabled: true, CreatedBy: cl.Username}
	if personal {
		t.OwnerGUID = string(cl.ObjectGUID)
	}
	if req.Description != nil {
		t.Description = *req.Description
	}
	if req.Enabled != nil {
		t.Enabled = *req.Enabled
	}

	created, err := s.repo.CreateDashTemplate(c.Request.Context(), t)
	if err != nil {
		s.writeAdminError(c, err, "テンプレートの作成に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: templateActionCode(created.OwnerGUID), Operation: "dash-template.create",
		Target: "template:" + created.Name,
		Detail: gin.H{"id": created.ID, "name": created.Name,
			"description": created.Description, "enabled": created.Enabled,
			"personal": created.OwnerGUID != ""},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusCreated, dashTemplateDTO(*created, true))
}

func (s *Server) UpdateDashTemplate(c *gin.Context, id int) {
	cl := mustClaims(c)
	// 個人テンプレート(本人所有)は本人が変更可、配布は settings:admin のみ。
	// 他人の個人テンプレートは Get の時点で 404 になる。
	cur, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレートの更新に失敗しました")
		return
	}
	if cur.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	var req api.DashTemplateUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	updated, err := s.repo.UpdateDashTemplate(c.Request.Context(), id, req.Name, req.Description, req.Enabled, string(cl.ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレートの更新に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: templateActionCode(cur.OwnerGUID), Operation: "dash-template.update",
		Target: "template:" + updated.Name,
		Detail: req, Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, dashTemplateDTO(*updated, true))
}

func (s *Server) DeleteDashTemplate(c *gin.Context, id int) {
	cl := mustClaims(c)

	t, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレートの削除に失敗しました")
		return
	}
	// 個人テンプレート(本人所有)は本人が削除可、配布は settings:admin のみ。
	if t.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if err := s.repo.DeleteDashTemplate(c.Request.Context(), id); err != nil {
		s.writeAdminError(c, err, "テンプレートの削除に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: templateActionCode(t.OwnerGUID), Operation: "dash-template.delete",
		Target: "template:" + t.Name,
		Detail: gin.H{"id": id, "name": t.Name, "items": len(t.Items), "personal": t.OwnerGUID != ""},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

func (s *Server) SetDashTemplateItems(c *gin.Context, id int) {
	cl := mustClaims(c)
	// 個人テンプレート(本人所有)は本人が変更可、配布は settings:admin のみ。
	cur, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレート項目の更新に失敗しました")
		return
	}
	if cur.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	var req api.SetDashTemplateItemsJSONBody
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	items := make([]admin.DashTemplateItem, 0, len(req.Items))
	for _, in := range req.Items {
		it := admin.DashTemplateItem{Kind: string(in.Kind)}
		switch it.Kind {
		case "action":
			if in.ActionId == nil {
				abortErr(c, http.StatusBadRequest, "validation_failed", "action 項目には actionId が必要です")
				return
			}
			it.ActionID = *in.ActionId
		case "link":
			if in.Name == nil || strings.TrimSpace(*in.Name) == "" || in.Url == nil || !isHTTPURL(*in.Url) {
				abortErr(c, http.StatusBadRequest, "validation_failed", "link 項目には name と http(s) の url が必要です")
				return
			}
			it.Name = strings.TrimSpace(*in.Name)
			it.URL = *in.Url
			it.Icon = "external-link"
			if in.Icon != nil && *in.Icon != "" {
				it.Icon = *in.Icon
			}
		case "table":
			if in.ManagedTableId == nil {
				abortErr(c, http.StatusBadRequest, "validation_failed", "table 項目には managedTableId が必要です")
				return
			}
			m, err := s.repo.GetManagedTable(c.Request.Context(), *in.ManagedTableId)
			if err != nil || !m.Enabled {
				abortErr(c, http.StatusBadRequest, "validation_failed", "指定されたテーブルは登録されていません")
				return
			}
			it.ManagedTableID = m.ID
		default:
			abortErr(c, http.StatusBadRequest, "validation_failed", "kind は action / link / table を指定してください")
			return
		}
		items = append(items, it)
	}

	updated, err := s.repo.ReplaceDashTemplateItems(c.Request.Context(), id, items, string(cl.ObjectGUID))
	if err != nil {
		s.writeAdminError(c, err, "テンプレート項目の更新に失敗しました")
		return
	}

	// 監査で「何を並べたか」まで特定できるよう項目内容も記録する。
	itemDetails := make([]gin.H, 0, len(items))
	for _, it := range items {
		d := gin.H{"kind": it.Kind}
		if it.Kind == "action" {
			d["actionId"] = it.ActionID
		} else {
			d["name"] = it.Name
			d["url"] = it.URL
		}
		itemDetails = append(itemDetails, d)
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: templateActionCode(cur.OwnerGUID), Operation: "dash-template.items",
		Target: "template:" + updated.Name,
		Detail: gin.H{"count": len(items), "items": itemDetails},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, dashTemplateDTO(*updated, true))
}

// ------------------------------------------------------------ me/dashboard

func (s *Server) GetMyDashboard(c *gin.Context) {
	cl := mustClaims(c)
	d, err := s.repo.GetUserDash(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		log.Printf("httpapi: get user dash: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "ダッシュボード設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, userDashDTO(*d))
}

func (s *Server) SetMyDashboard(c *gin.Context) {
	cl := mustClaims(c)

	var req api.UserDashboard
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	d := admin.UserDash{TemplateID: req.TemplateId}
	if req.CardOrder != nil {
		b, err := json.Marshal(*req.CardOrder)
		if err != nil {
			abortErr(c, http.StatusBadRequest, "validation_failed", "cardOrder が不正です")
			return
		}
		d.CardOrder = string(b)
	}
	if req.HiddenKeys != nil {
		b, err := json.Marshal(*req.HiddenKeys)
		if err != nil {
			abortErr(c, http.StatusBadRequest, "validation_failed", "hiddenKeys が不正です")
			return
		}
		d.HiddenKeys = string(b)
	}

	if err := s.repo.SetUserDash(c.Request.Context(), cl.ObjectGUID, d); err != nil {
		s.writeAdminError(c, err, "ダッシュボード設定の保存に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: actionDashboard, Operation: "dashboard.update",
		Detail: gin.H{"templateId": req.TemplateId},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})

	saved, err := s.repo.GetUserDash(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, "internal", "保存後の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, userDashDTO(*saved))
}

// templateActionCode: 個人テンプレートの操作は本人のダッシュボード操作として
// dashboard、配布テンプレートの管理は settings として監査に残す。
func templateActionCode(ownerGUID string) string {
	if ownerGUID != "" {
		return actionDashboard
	}
	return authz.ActionSettings
}

// ---------------------------------------------------------------- DTOs

func dashTemplateDTO(t admin.DashTemplate, withItems bool) api.DashTemplate {
	out := api.DashTemplate{
		Id:      t.ID,
		Name:    t.Name,
		Enabled: t.Enabled,
	}
	if t.OwnerGUID != "" {
		out.Personal = ptr(true)
	}
	if t.Description != "" {
		out.Description = ptr(t.Description)
	}
	if withItems {
		items := make([]api.DashTemplateItem, 0, len(t.Items))
		for _, it := range t.Items {
			dto := api.DashTemplateItem{
				Id:       it.ID,
				Position: it.Position,
				Kind:     api.DashTemplateItemKind(it.Kind),
			}
			if it.Kind == "action" {
				dto.ActionId = ptr(it.ActionID)
				if it.ActionCode != "" {
					dto.ActionCode = ptr(it.ActionCode)
				}
			} else if it.Kind == "table" {
				dto.ManagedTableId = ptr(it.ManagedTableID)
				if it.ManagedTableName != "" {
					dto.ManagedTableName = ptr(it.ManagedTableName)
				}
			} else {
				if it.Name != "" {
					dto.Name = ptr(it.Name)
				}
				if it.URL != "" {
					dto.Url = ptr(it.URL)
				}
				if it.Icon != "" {
					dto.Icon = ptr(it.Icon)
				}
			}
			items = append(items, dto)
		}
		out.Items = &items
	}
	return out
}

func userDashDTO(d admin.UserDash) api.UserDashboard {
	out := api.UserDashboard{TemplateId: d.TemplateID}
	if d.CardOrder != "" {
		var order []string
		if err := json.Unmarshal([]byte(d.CardOrder), &order); err == nil {
			out.CardOrder = &order
		}
	}
	if d.HiddenKeys != "" {
		var hidden []string
		if err := json.Unmarshal([]byte(d.HiddenKeys), &hidden); err == nil {
			out.HiddenKeys = &hidden
		}
	}
	return out
}
