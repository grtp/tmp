// home-config: ホーム画面のウィジェット構成(全ユーザー共通の単一 JSON)。
// 構造の正はフロント(レンダラ/ビルダー)にあり,ここでは
// 「有効な JSON・64KB 以下」だけを検証して不透明に保存する。
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

// maxHomeConfigBytes は config の上限(UTF-8 バイト数)。
const maxHomeConfigBytes = 64 * 1024

// GetHomeConfig はホーム構成を返す(ログイン済みなら誰でも)。
// 未設定なら config: null(フロントは組込の既定表示にフォールバック)。
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

// SetHomeConfig はホーム構成を全置換する(保存 = 即公開)。
// config: null は設定の削除(未設定 = 既定表示に戻す)。
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

	// 監査に before/after を残すため変更前の構成を取っておく
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

// rawJSONOrNil は検証済み JSON 文字列を監査 detail に「JSON のまま」埋める
// (文字列エスケープで二重に包むと履歴画面で読めないため)。
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
