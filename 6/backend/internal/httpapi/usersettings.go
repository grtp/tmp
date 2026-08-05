package httpapi

import (
	"net/http"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/repo"
)

// GetMySettings は本人の個人設定を返す(他人の設定は読めない)。
func (s *Server) GetMySettings(c *gin.Context) {
	st, err := s.repo.GetUserSettings(c.Request.Context(), mustClaims(c).ObjectGUID)
	if err != nil {
		internalError(c, "get user settings", err, "個人設定の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, userSettingsDTO(st))
}

// UpdateMySettings は本人の個人設定を更新する。
// 監査記録は残さない(本人の見た目の好みで,業務データに影響しないため)。
func (s *Server) UpdateMySettings(c *gin.Context) {
	cl := mustClaims(c)

	var req api.UserSettingsUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.HeaderClock != nil {
		switch string(*req.HeaderClock) {
		case "none", "minute", "second", "custom":
		default:
			badRequest(c, "時計設定の値が不正です")
			return
		}
		if err := s.repo.SetUserSetting(c.Request.Context(), cl.ObjectGUID,
			repo.SettingHeaderClock, string(*req.HeaderClock), cl.Username); err != nil {
			internalError(c, "update user settings", err, "個人設定の更新に失敗しました")
			return
		}
	}
	if req.HeaderClockFormat != nil {
		if utf8.RuneCountInString(*req.HeaderClockFormat) > 64 {
			badRequest(c, "時計の書式が長すぎます(64文字以下にしてください)")
			return
		}
		if err := s.repo.SetUserSetting(c.Request.Context(), cl.ObjectGUID,
			repo.SettingHeaderClockFormat, *req.HeaderClockFormat, cl.Username); err != nil {
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
	return api.UserSettings{
		HeaderClock:       api.UserSettingsHeaderClock(s.HeaderClock),
		HeaderClockFormat: s.HeaderClockFormat,
	}
}
