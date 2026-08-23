package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

const maxHomeConfigBytes = 64 * 1024

func (s *Server) GetHomeConfig(c *gin.Context) {
	hc, err := s.repo.GetHomeConfig(c.Request.Context())
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusOK, api.HomeConfig{Config: nil})
			return
		}
		internalError(c, "get home config", err, "ホーム設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, homeConfigDTO(hc))
}

func (s *Server) SetHomeConfig(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.HomeConfigUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.Config != nil {
		if len(*req.Config) > maxHomeConfigBytes {
			badRequest(c, "ホーム設定が大きすぎます(64KB 以下にしてください)")
			return
		}
		if !json.Valid([]byte(*req.Config)) {
			badRequest(c, "ホーム設定は有効な JSON ではありません")
			return
		}
	}

	var before *string
	if cur, err := s.repo.GetHomeConfig(c.Request.Context()); err == nil {
		before = &cur.Config
	} else if !errors.Is(err, repo.ErrNotFound) {
		internalError(c, "get home config", err, "ホーム設定の更新に失敗しました")
		return
	}

	if req.Config == nil {
		if err := s.repo.DeleteHomeConfig(c.Request.Context()); err != nil {
			internalError(c, "delete home config", err, "ホーム設定の更新に失敗しました")
			return
		}
	} else if err := s.repo.SetHomeConfig(c.Request.Context(), *req.Config, cl.Username); err != nil {
		internalError(c, "set home config", err, "ホーム設定の更新に失敗しました")
		return
	}

	s.auditOK(c, authz.ActionSettings, "home-config.update", "home-config", map[string]any{
		"before": rawJSONOrNil(before), "after": rawJSONOrNil(req.Config),
	})

	hc, err := s.repo.GetHomeConfig(c.Request.Context())
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusOK, api.HomeConfig{Config: nil})
			return
		}
		internalError(c, "get home config", err, "ホーム設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, homeConfigDTO(hc))
}

func rawJSONOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return json.RawMessage(*p)
}

func homeConfigDTO(hc *repo.HomeConfig) api.HomeConfig {
	return api.HomeConfig{
		Config:    &hc.Config,
		UpdatedBy: &hc.UpdatedBy,
		UpdatedAt: &hc.UpdatedAt,
	}
}
