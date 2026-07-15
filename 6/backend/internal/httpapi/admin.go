package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"

	api "f-tool/gen/api"
	"f-tool/internal/admin"
	"f-tool/internal/audit"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"
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

// isHTTPURL は個人リンク(/me/links)の URL バリデーションに使う。
func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
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
	if req.Enabled != nil {
		// settings を無効化すると誰も設定画面に入れなくなる(ロックアウト)。
		// UI にはチェックボックス自体が無いが、API 直叩きもここで拒否する。
		target, err := s.repo.GetAction(c.Request.Context(), id)
		if err != nil {
			s.writeAdminError(c, err, "機能の更新に失敗しました")
			return
		}
		if target.Code == authz.ActionSettings {
			abortErr(c, http.StatusConflict, "conflict", "設定機能の有効/無効は変更できません")
			return
		}
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

// ExportHistory はフィルタ条件に一致する全履歴を CSV でストリーム出力する。
func (s *Server) ExportHistory(c *gin.Context, params api.ExportHistoryParams) {
	if !s.require(c, authz.ActionHistory, authz.LevelMaintainer) {
		return
	}
	cl := mustClaims(c)

	f := admin.HistoryFilter{}
	if params.Username != nil {
		f.Username = *params.Username
	}
	if params.ActionCode != nil {
		f.ActionCode = *params.ActionCode
	}
	if params.Target != nil {
		f.Target = *params.Target
	}
	if params.Operation != nil {
		f.Operation = *params.Operation
	}
	if params.ClientIp != nil {
		f.ClientIP = *params.ClientIp
	}
	if params.Result != nil {
		f.Result = string(*params.Result)
	}
	f.From = params.From
	f.To = params.To

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="operation_history.csv"`)

	n, err := s.repo.ExportHistoryCSV(c.Request.Context(), f, c.Writer)
	if err != nil {
		// ストリーム開始後はステータスを変えられないため、ログと監査のみ。
		log.Printf("httpapi: export history: %v", err)
		s.audits.Write(c.Request.Context(), audit.Entry{
			ObjectGUID: cl.ObjectGUID, Username: cl.Username,
			ActionCode: authz.ActionHistory, Operation: "history.export",
			Detail: gin.H{"rows": n, "error": err.Error()},
			Result: audit.ResultFailure, ErrorCode: "internal", ClientIP: c.ClientIP(),
		})
		return
	}
	// 監査ログ自体の持ち出しも記録する。
	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: cl.ObjectGUID, Username: cl.Username,
		ActionCode: authz.ActionHistory, Operation: "history.export",
		Detail: gin.H{"rows": n},
		Result: audit.ResultSuccess, ClientIP: c.ClientIP(),
	})
}

func (s *Server) ListHistory(c *gin.Context, params api.ListHistoryParams) {
	// 履歴は専用権限(maintainer 以上)。settings とは独立に付与できる。
	if !s.require(c, authz.ActionHistory, authz.LevelMaintainer) {
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
	if params.Operation != nil {
		f.Operation = *params.Operation
	}
	if params.ClientIp != nil {
		f.ClientIP = *params.ClientIp
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

// GetHistoryOverflow は detail が 1MB を超えて MinIO へ退避された全文を返す。
// ブラウザに直接ストレージを触らせず、backend がサーバーサイドで取得する。
func (s *Server) GetHistoryOverflow(c *gin.Context, id int) {
	if !s.require(c, authz.ActionHistory, authz.LevelMaintainer) {
		return
	}
	if s.blobs == nil {
		abortErr(c, http.StatusNotFound, "not_found", "全文の退避機能は無効です")
		return
	}
	detail, err := s.repo.GetHistoryDetail(c.Request.Context(), int64(id))
	if errors.Is(err, sql.ErrNoRows) {
		abortErr(c, http.StatusNotFound, "not_found", "履歴が見つかりません")
		return
	}
	if err != nil {
		log.Printf("httpapi: history overflow: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "履歴の取得に失敗しました")
		return
	}

	var marker struct {
		OverflowKey string `json:"overflowKey"`
	}
	if detail == "" || json.Unmarshal([]byte(detail), &marker) != nil || marker.OverflowKey == "" {
		abortErr(c, http.StatusNotFound, "not_found", "この履歴には退避された全文がありません")
		return
	}

	full, err := s.blobs.Get(c.Request.Context(), marker.OverflowKey)
	if err != nil {
		log.Printf("httpapi: history overflow fetch: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "全文の取得に失敗しました")
		return
	}
	c.Data(http.StatusOK, "application/json", full)
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
