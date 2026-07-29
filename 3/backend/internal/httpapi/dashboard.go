package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

// ダッシュボードテンプレート: 管理(CRUD/items)は settings:admin，
// 一覧参照(enabled のみ)と自分の選択は認証のみ。

func (s *Server) ListDashTemplates(c *gin.Context, params api.ListDashTemplatesParams) {
	all := params.All != nil && *params.All
	if all && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.repo.ListDashTemplates(c.Request.Context(), all, string(mustClaims(c).ObjectGUID))
	if err != nil {
		internalError(c, "list dash templates", err, "テンプレート一覧の取得に失敗しました")
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
		s.writeRepoError(c, err, "テンプレートの取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, dashTemplateDTO(*t, true))
}

func (s *Server) CreateDashTemplate(c *gin.Context) {
	cl := mustClaims(c)

	var req api.DashTemplateCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	// 個人テンプレートは誰でも自分用に作れる。配布は settings:admin のみ。
	personal := req.Personal != nil && *req.Personal
	if !personal && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		badRequest(c, "name は必須です")
		return
	}

	t := repo.DashTemplate{Name: strings.TrimSpace(req.Name), Enabled: true, CreatedBy: cl.Username}
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
		s.writeRepoError(c, err, "テンプレートの作成に失敗しました")
		return
	}

	s.auditOK(c, templateActionCode(created.OwnerGUID), "dash-template.create", "template:"+created.Name,
		gin.H{"id": created.ID, "name": created.Name,
			"description": created.Description, "enabled": created.Enabled,
			"personal": created.OwnerGUID != ""})
	c.JSON(http.StatusCreated, dashTemplateDTO(*created, true))
}

func (s *Server) UpdateDashTemplate(c *gin.Context, id int) {
	cl := mustClaims(c)
	// 個人テンプレート(本人所有)は本人が変更可，配布は settings:admin のみ。
	// 他人の個人テンプレートは Get の時点で 404 になる。
	cur, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeRepoError(c, err, "テンプレートの更新に失敗しました")
		return
	}
	if cur.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	var req api.DashTemplateUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	updated, err := s.repo.UpdateDashTemplate(c.Request.Context(), id, req.Name, req.Description, req.Enabled, string(cl.ObjectGUID), cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "テンプレートの更新に失敗しました")
		return
	}

	s.auditOK(c, templateActionCode(cur.OwnerGUID), "dash-template.update", "template:"+updated.Name,
		req)
	c.JSON(http.StatusOK, dashTemplateDTO(*updated, true))
}

func (s *Server) DeleteDashTemplate(c *gin.Context, id int) {
	cl := mustClaims(c)

	t, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeRepoError(c, err, "テンプレートの削除に失敗しました")
		return
	}
	// 個人テンプレート(本人所有)は本人が削除可，配布は settings:admin のみ。
	if t.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if err := s.repo.DeleteDashTemplate(c.Request.Context(), id); err != nil {
		s.writeRepoError(c, err, "テンプレートの削除に失敗しました")
		return
	}

	s.auditOK(c, templateActionCode(t.OwnerGUID), "dash-template.delete", "template:"+t.Name,
		gin.H{"id": id, "name": t.Name, "items": len(t.Items), "personal": t.OwnerGUID != ""})
	c.Status(http.StatusNoContent)
}

func (s *Server) SetDashTemplateItems(c *gin.Context, id int) {
	cl := mustClaims(c)
	// 個人テンプレート(本人所有)は本人が変更可，配布は settings:admin のみ。
	cur, err := s.repo.GetDashTemplate(c.Request.Context(), id, string(cl.ObjectGUID))
	if err != nil {
		s.writeRepoError(c, err, "テンプレート項目の更新に失敗しました")
		return
	}
	if cur.OwnerGUID == "" && !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	var req api.SetDashTemplateItemsJSONBody
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	// 配布テンプレートは admin が全ユーザー向けに組むため権限検査はしない
	// (閲覧側でレンダリング時に除外される)。
	items, itemErr := s.parseDashItems(c.Request.Context(), templateItemInputs(req.Items), nil)
	if itemErr != nil {
		respondDashItemError(c, itemErr)
		return
	}

	updated, err := s.repo.ReplaceDashTemplateItems(
		c.Request.Context(), id, toTemplateItems(items), string(cl.ObjectGUID), cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "テンプレート項目の更新に失敗しました")
		return
	}

	// 監査で「何を並べたか」まで特定できるよう項目内容も記録する。
	s.auditOK(c, templateActionCode(cur.OwnerGUID), "dash-template.items",
		"template:"+updated.Name,
		gin.H{"count": len(items), "items": auditItemDetails(items)})
	c.JSON(http.StatusOK, dashTemplateDTO(*updated, true))
}

// actionDashboard は個人ダッシュボード操作(項目の追加/削除/並べ替え等)の
// 履歴用の擬似 action code(ftool_app_actions には存在しない)。
const actionDashboard = "dashboard"

func (s *Server) GetMyDashItems(c *gin.Context) {
	cl := mustClaims(c)
	items, err := s.repo.ListUserDashItems(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		internalError(c, "list user dash items", err, "ダッシュボード項目の取得に失敗しました")
		return
	}
	out := make([]api.UserDashItem, 0, len(items))
	for _, it := range items {
		out = append(out, userDashItemDTO(it))
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

func (s *Server) SetMyDashItems(c *gin.Context) {
	cl := mustClaims(c)

	var req api.SetMyDashItemsJSONBody
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	// 個人の実体化コピーなので，本人が実際に持つ権限の範囲でしか項目を
	// 持てない(API 直叩きでの権限外カード追加を防ぐ防衛線。UI は元々
	// 権限のある機能/テーブルしか選択肢に出さない)。
	items, itemErr := s.parseDashItems(c.Request.Context(), userItemInputs(req.Items), mustGrants(c))
	if itemErr != nil {
		respondDashItemError(c, itemErr)
		return
	}

	saved, err := s.repo.ReplaceUserDashItems(c.Request.Context(), cl.ObjectGUID, toUserItems(items), cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "ダッシュボード項目の保存に失敗しました")
		return
	}

	s.auditOK(c, actionDashboard, "dash-items.replace", "", gin.H{"count": len(items)})

	out := make([]api.UserDashItem, 0, len(saved))
	for _, it := range saved {
		out = append(out, userDashItemDTO(it))
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

func templateActionCode(ownerGUID string) string {
	if ownerGUID != "" {
		return actionDashboard
	}
	return authz.ActionSettings
}

func dashTemplateDTO(t repo.DashTemplate, withItems bool) api.DashTemplate {
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

func userDashItemDTO(it repo.UserDashItem) api.UserDashItem {
	out := api.UserDashItem{
		Id:       it.ID,
		Position: it.Position,
		Kind:     api.UserDashItemKind(it.Kind),
	}
	if it.Kind == "action" {
		out.ActionId = ptr(it.ActionID)
		if it.ActionCode != "" {
			out.ActionCode = ptr(it.ActionCode)
		}
	} else if it.Kind == "table" {
		out.ManagedTableId = ptr(it.ManagedTableID)
		if it.ManagedTableName != "" {
			out.ManagedTableName = ptr(it.ManagedTableName)
		}
	} else {
		if it.Name != "" {
			out.Name = ptr(it.Name)
		}
		if it.URL != "" {
			out.Url = ptr(it.URL)
		}
		if it.Icon != "" {
			out.Icon = ptr(it.Icon)
		}
	}
	return out
}

// GetMySettings は本人の個人設定を返す(他人の設定は読めない)。
func (s *Server) GetMySettings(c *gin.Context) {
	cl := mustClaims(c)
	st, err := s.repo.GetUserSettings(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		internalError(c, "get user settings", err, "個人設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, userSettingsDTO(st))
}

// UpdateMySettings は本人の個人設定を更新する。
// 監査記録は残さない(本人の見た目の好みで，業務データに影響しないため)。
func (s *Server) UpdateMySettings(c *gin.Context) {
	cl := mustClaims(c)

	var req api.UserSettingsUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.HeaderClockSeconds != nil {
		if err := s.repo.SetHeaderClockSeconds(c.Request.Context(), cl.ObjectGUID, *req.HeaderClockSeconds, cl.Username); err != nil {
			internalError(c, "update user settings", err, "個人設定の更新に失敗しました")
			return
		}
	}

	st, err := s.repo.GetUserSettings(c.Request.Context(), cl.ObjectGUID)
	if err != nil {
		internalError(c, "get user settings", err, "個人設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, userSettingsDTO(st))
}

func userSettingsDTO(s repo.UserSettings) api.UserSettings {
	return api.UserSettings{HeaderClockSeconds: s.HeaderClockSeconds}
}
