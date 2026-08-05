// users: ユーザー一覧と機能権限の割り当て(設定 > ユーザー権限)。
package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"
	"f-tool/internal/predicate"
	"f-tool/internal/repo"
)

func (s *Server) ListUsers(c *gin.Context, _ api.ListUsersParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	// limit 省略時は上限まで返す(段階移行の互換: 旧クライアントは全件前提)。
	limit, err := intQuery(c, "limit", 1000)
	if err != nil || limit < 1 || limit > 1000 {
		badRequest(c, "limit は 1〜1000 で指定してください")
		return
	}
	offset, err := intQuery(c, "offset", 0)
	if err != nil || offset < 0 {
		badRequest(c, "offset は 0 以上で指定してください")
		return
	}
	preds, err := predicate.ParseParam(c.Query("preds"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	page, err := s.repo.ListUsers(c.Request.Context(), repo.ListUsersParams{
		Preds: preds, Limit: limit, Offset: offset,
	})
	if err != nil {
		var ve *predicate.ValidationError
		if errors.As(err, &ve) {
			badRequest(c, ve.Msg)
			return
		}
		internalError(c, "list users", err, "ユーザー一覧の取得に失敗しました")
		return
	}
	out := make([]api.UserWithAuth, 0, len(page.Users))
	for _, u := range page.Users {
		dto, err := userDTO(u)
		if err != nil {
			applog.From(c.Request.Context()).Error("user dto failed", "err", err)
			continue
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, gin.H{
		"users": out, "total": page.Total, "limit": page.Limit, "offset": page.Offset,
	})
}

func (s *Server) SetUserAuth(c *gin.Context, objectGuid openapi_types.UUID) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	target := adguid.GUID(strings.ToLower(objectGuid.String()))

	var req api.SetUserAuthJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}

	assignments := make([]repo.AuthAssignment, 0, len(req.Assignments))
	for _, a := range req.Assignments {
		lvl := authz.Level(a.AuthLevel)
		if !lvl.Valid() {
			badRequest(c, "authLevel が不正です")
			return
		}
		assignments = append(assignments, repo.AuthAssignment{ActionID: a.ActionId, AuthLevel: lvl})
	}

	// 自分自身から settings:admin を外すことはできない(ロックアウト防止)。
	if target == cl.ObjectGUID {
		settingsID, err := s.actionIDByCode(c, authz.ActionSettings)
		if err != nil {
			abortErr(c, http.StatusInternalServerError, "internal", "権限の検証に失敗しました")
			return
		}
		keeps := false
		for _, a := range assignments {
			if a.ActionID == settingsID && a.AuthLevel == authz.LevelAdmin {
				keeps = true
				break
			}
		}
		if !keeps {
			abortErr(c, http.StatusConflict, "conflict", "自分自身から設定管理(admin)を外すことはできません")
			return
		}
	}

	// 監査に before/after を残すため変更前の付与状態を取っておく
	// (rows.batch の ChangeRecord と同じキー名で揃える)。
	current, err := s.repo.GetUser(c.Request.Context(), target)
	if err != nil {
		s.writeRepoError(c, err, "対象ユーザーの取得に失敗しました")
		return
	}

	if err := s.repo.ReplaceUserAuth(c.Request.Context(), target, assignments, cl.Username); err != nil {
		s.writeRepoError(c, err, "権限の更新に失敗しました")
		return
	}

	updated, err := s.repo.GetUser(c.Request.Context(), target)
	if err != nil {
		s.writeRepoError(c, err, "更新後の取得に失敗しました")
		return
	}

	s.auditOK(c, authz.ActionSettings, "user-auth.replace", "user:"+updated.Username,
		gin.H{"objectGuid": string(target),
			"before": auditAuthEntries(current.Auth), "after": auditAuthEntries(updated.Auth)})

	dto, err := userDTO(*updated)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, "internal", "更新後の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, dto)
}

func userDTO(u repo.UserWithAuth) (api.UserWithAuth, error) {
	guid, err := parseUUID(string(u.ObjectGUID))
	if err != nil {
		return api.UserWithAuth{}, err
	}
	out := api.UserWithAuth{
		ObjectGuid:  guid,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Auth:        make([]api.UserAuthEntry, 0, len(u.Auth)),
	}
	if u.Email != "" {
		out.Email = ptr(u.Email)
	}
	if u.LastLoginAt != nil {
		out.LastLoginAt = u.LastLoginAt
	}
	for _, a := range u.Auth {
		out.Auth = append(out.Auth, api.UserAuthEntry{
			ActionId:   a.ActionID,
			ActionCode: a.ActionCode,
			AuthLevel:  api.AuthLevel(a.AuthLevel),
		})
	}
	return out, nil
}

// auditAuthEntries は権限付与の一覧を監査 detail 用に整形する。
// actionCode を含めるのは, 履歴を後から読むときに actionId の数値だけでは
// どの機能か分からないため。
func auditAuthEntries(list []repo.UserAuthEntry) []gin.H {
	out := make([]gin.H, 0, len(list))
	for _, a := range list {
		out = append(out, gin.H{
			"actionId": a.ActionID, "actionCode": a.ActionCode, "authLevel": a.AuthLevel,
		})
	}
	return out
}

func parseUUID(s string) (openapi_types.UUID, error) {
	var u openapi_types.UUID
	err := u.UnmarshalText([]byte(s))
	return u, err
}
