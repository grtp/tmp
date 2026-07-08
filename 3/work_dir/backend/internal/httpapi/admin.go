package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	api "tablemaint/gen/api"
	"tablemaint/internal/admin"
	"tablemaint/internal/audit"
	"tablemaint/internal/auth/adguid"
	"tablemaint/internal/authz"
)

// ----------------------------------------------------------------- users

func (s *Server) ListUsers(c *gin.Context, params api.ListUsersParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	q := ""
	if params.Q != nil {
		q = *params.Q
	}
	users, err := s.repo.ListUsers(c.Request.Context(), q)
	if err != nil {
		log.Printf("httpapi: list users: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "ユーザー一覧の取得に失敗しました")
		return
	}
	out := make([]api.UserWithAuth, 0, len(users))
	for _, u := range users {
		dto, err := userDTO(u)
		if err != nil {
			log.Printf("httpapi: user dto: %v", err)
			continue
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, gin.H{"users": out})
}

func (s *Server) SetUserAuth(c *gin.Context, objectGuid openapi_types.UUID) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	target := adguid.GUID(strings.ToLower(objectGuid.String()))

	var req api.SetUserAuthJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	assignments := make([]admin.AuthAssignment, 0, len(req.Assignments))
	for _, a := range req.Assignments {
		lvl := authz.Level(a.AuthLevel)
		if !lvl.Valid() {
			abortErr(c, http.StatusBadRequest, "validation_failed", "authLevel が不正です")
			return
		}
		assignments = append(assignments, admin.AuthAssignment{ActionID: a.ActionId, AuthLevel: lvl})
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

	if err := s.repo.ReplaceUserAuth(c.Request.Context(), target, assignments, cl.Username); err != nil {
		s.writeAdminError(c, err, "権限の更新に失敗しました")
		return
	}

	updated, err := s.repo.GetUser(c.Request.Context(), target)
	if err != nil {
		s.writeAdminError(c, err, "更新後の取得に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "user-auth.replace",
		Target: "user:" + updated.Username,
		Detail: gin.H{"objectGuid": string(target), "assignments": req.Assignments},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})

	dto, err := userDTO(*updated)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, "internal", "更新後の取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, dto)
}

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
	return 0, admin.ErrNotFound
}

// --------------------------------------------------------------- actions

func (s *Server) ListActions(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	actions, err := s.repo.ListActions(c.Request.Context())
	if err != nil {
		log.Printf("httpapi: list actions: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "機能一覧の取得に失敗しました")
		return
	}
	out := make([]api.Action, 0, len(actions))
	for _, a := range actions {
		out = append(out, actionDTO(a))
	}
	c.JSON(http.StatusOK, gin.H{"actions": out})
}

var actionCodeRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

func (s *Server) CreateAction(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ActionCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}
	if !actionCodeRe.MatchString(req.Code) {
		abortErr(c, http.StatusBadRequest, "validation_failed", "code は英小文字始まり・英数字とハイフンのみです")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed", "name は必須です")
		return
	}

	a := admin.Action{Code: req.Code, Name: req.Name, Icon: "apps", Enabled: true}
	if req.Icon != nil && *req.Icon != "" {
		a.Icon = *req.Icon
	}
	if req.SortOrder != nil {
		a.SortOrder = *req.SortOrder
	}
	if req.Enabled != nil {
		a.Enabled = *req.Enabled
	}

	created, err := s.repo.CreateAction(c.Request.Context(), a)
	if err != nil {
		s.writeAdminError(c, err, "機能の追加に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "action.create",
		Target: "action:" + created.Code,
		Detail: gin.H{"id": created.ID, "name": created.Name},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusCreated, actionDTO(*created))
}

func (s *Server) UpdateAction(c *gin.Context, id api.ActionId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.ActionUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		abortErr(c, http.StatusBadRequest, "validation_failed", "リクエスト形式が不正です")
		return
	}

	updated, err := s.repo.UpdateAction(c.Request.Context(), id, req.Name, req.Icon, req.SortOrder, req.Enabled)
	if err != nil {
		s.writeAdminError(c, err, "機能の更新に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "action.update",
		Target: "action:" + updated.Code,
		Detail: req, Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.JSON(http.StatusOK, actionDTO(*updated))
}

func (s *Server) DeleteAction(c *gin.Context, id api.ActionId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	a, err := s.repo.GetAction(c.Request.Context(), id)
	if err != nil {
		s.writeAdminError(c, err, "機能の削除に失敗しました")
		return
	}
	if err := s.repo.DeleteAction(c.Request.Context(), id); err != nil {
		s.writeAdminError(c, err, "機能の削除に失敗しました")
		return
	}

	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionSettings, Operation: "action.delete",
		Target: "action:" + a.Code,
		Detail: gin.H{"id": id, "name": a.Name},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
	c.Status(http.StatusNoContent)
}

// --------------------------------------------------------------- history

func (s *Server) ListHistory(c *gin.Context, params api.ListHistoryParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}

	f := admin.HistoryFilter{Limit: 50, Offset: 0}
	if params.Username != nil {
		f.Username = *params.Username
	}
	if params.ActionCode != nil {
		f.ActionCode = *params.ActionCode
	}
	if params.Target != nil {
		f.Target = *params.Target
	}
	if params.Result != nil {
		f.Result = string(*params.Result)
	}
	f.From = params.From
	f.To = params.To
	if params.Limit != nil {
		f.Limit = *params.Limit
	}
	if params.Offset != nil {
		f.Offset = *params.Offset
	}
	if f.Limit < 1 || f.Limit > 200 {
		abortErr(c, http.StatusBadRequest, "validation_failed", "limit は 1〜200 で指定してください")
		return
	}
	if f.Offset < 0 {
		abortErr(c, http.StatusBadRequest, "validation_failed", "offset は 0 以上で指定してください")
		return
	}

	page, err := s.repo.QueryHistory(c.Request.Context(), f)
	if err != nil {
		log.Printf("httpapi: history: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "履歴の取得に失敗しました")
		return
	}

	entries := make([]api.HistoryEntry, 0, len(page.Entries))
	for _, e := range page.Entries {
		entries = append(entries, historyDTO(e))
	}
	c.JSON(http.StatusOK, api.HistoryPage{
		Entries: entries,
		Total:   page.Total,
		Limit:   page.Limit,
		Offset:  page.Offset,
	})
}

// ---------------------------------------------------------------- DTOs

func userDTO(u admin.UserWithAuth) (api.UserWithAuth, error) {
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

func actionDTO(a admin.Action) api.Action {
	return api.Action{
		Id:        a.ID,
		Code:      a.Code,
		Name:      a.Name,
		Icon:      a.Icon,
		SortOrder: a.SortOrder,
		Enabled:   a.Enabled,
		IsBuiltin: a.IsBuiltin,
	}
}

func historyDTO(e admin.HistoryEntry) api.HistoryEntry {
	out := api.HistoryEntry{
		Id:         e.ID,
		OccurredAt: e.OccurredAt,
		Username:   e.Username,
		ActionCode: e.ActionCode,
		Operation:  e.Operation,
		Result:     api.HistoryEntryResult(e.Result),
	}
	if e.ObjectGUID != "" {
		if guid, err := parseUUID(e.ObjectGUID); err == nil {
			out.ObjectGuid = &guid
		}
	}
	if e.Target != "" {
		out.Target = ptr(e.Target)
	}
	if e.Detail != "" {
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(e.Detail), &m); err == nil {
			out.Detail = &m
		}
	}
	if e.ErrorCode != "" {
		out.ErrorCode = ptr(e.ErrorCode)
	}
	if e.ClientIP != "" {
		out.ClientIp = ptr(e.ClientIP)
	}
	return out
}

func parseUUID(s string) (openapi_types.UUID, error) {
	var u openapi_types.UUID
	err := u.UnmarshalText([]byte(s))
	return u, err
}
