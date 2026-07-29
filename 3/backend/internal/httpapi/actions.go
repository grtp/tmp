// actions: 機能マスタ(設定 > 機能設定)。行の追加・削除は API に無い。
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

func (s *Server) actionIDByCode(c *gin.Context, code string) (int, error) {
	actions, err := s.repo.ListActions(c.Request.Context())
	if err != nil {
		return 0, err
	}
	for _, a := range actions {
		if a.Code == code {
			return a.ID, nil
		}
	}
	return 0, repo.ErrNotFound
}

func (s *Server) ListActions(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	actions, err := s.repo.ListActions(c.Request.Context())
	if err != nil {
		internalError(c, "list actions", err, "機能一覧の取得に失敗しました")
		return
	}
	out := make([]api.Action, 0, len(actions))
	for _, a := range actions {
		out = append(out, actionDTO(a))
	}
	c.JSON(http.StatusOK, gin.H{"actions": out})
}

func (s *Server) UpdateAction(c *gin.Context, id api.ActionId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ActionUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.Enabled != nil {
		// settings を無効化すると誰も設定画面に入れなくなる(ロックアウト)。
		// UI にはチェックボックス自体が無いが，API 直叩きもここで拒否する。
		target, err := s.repo.GetAction(c.Request.Context(), id)
		if err != nil {
			s.writeRepoError(c, err, "機能の更新に失敗しました")
			return
		}
		if target.Code == authz.ActionSettings {
			abortErr(c, http.StatusConflict, "conflict", "設定機能の有効/無効は変更できません")
			return
		}
	}

	updated, err := s.repo.UpdateAction(c.Request.Context(), id, req.Name, req.Icon, req.SortOrder, req.Enabled, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "機能の更新に失敗しました")
		return
	}

	s.auditOK(c, authz.ActionSettings, "action.update", "action:"+updated.Code,
		req)
	c.JSON(http.StatusOK, actionDTO(*updated))
}

func actionDTO(a repo.Action) api.Action {
	return api.Action{
		Id:        a.ID,
		Code:      a.Code,
		Name:      a.Name,
		Icon:      a.Icon,
		SortOrder: a.SortOrder,
		Enabled:   a.Enabled,
	}
}
