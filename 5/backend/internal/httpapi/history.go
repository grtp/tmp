// history: 操作履歴の一覧・CSV 出力・detail 退避分の取得。
package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/authz"
	"f-tool/internal/predicate"
	"f-tool/internal/repo"
)

// ExportHistory はフィルタ一致の全履歴を CSV でストリーム出力する。
// preds は生成された params 構造体を経由せず c.Query で直接読む
// (rows/users 系のクエリ主体ハンドラと同じ流儀。ListRows/ExportRows 参照)。
func (s *Server) ExportHistory(c *gin.Context, _ api.ExportHistoryParams) {
	if !s.require(c, authz.ActionHistory, authz.LevelMaintainer) {
		return
	}

	f := repo.HistoryFilter{}
	preds, err := predicate.ParseParam(c.Query("preds"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	f.Preds = preds
	// 述語の検証エラー(不正列名など)をヘッダー送信前に検出する。
	if _, _, err := repo.ValidateHistoryFilter(f); err != nil {
		var ve *predicate.ValidationError
		if errors.As(err, &ve) {
			badRequest(c, ve.Msg)
			return
		}
		internalError(c, "export history", err, "履歴の取得に失敗しました")
		return
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="operation_history.csv"`)

	n, err := s.renderHistoryCSV(c.Request.Context(), f, c.Writer)
	if err != nil {
		// ストリーム開始後はステータスを変えられないため,ログと監査のみ。
		applog.From(c.Request.Context()).Error("export history failed", "err", err)
		s.auditNG(c, authz.ActionHistory, "history.export", "",
			gin.H{"rows": n, "error": err.Error()}, "internal")
		return
	}
	// 監査ログ自体の持ち出しも記録する。
	s.auditOK(c, authz.ActionHistory, "history.export", "",
		gin.H{"rows": n})
}

func (s *Server) ListHistory(c *gin.Context, params api.ListHistoryParams) {
	// 履歴は専用権限(maintainer 以上)。settings とは独立に付与できる。
	if !s.require(c, authz.ActionHistory, authz.LevelMaintainer) {
		return
	}

	f := repo.HistoryFilter{Limit: 50, Offset: 0}
	if params.Limit != nil {
		f.Limit = *params.Limit
	}
	if params.Offset != nil {
		f.Offset = *params.Offset
	}
	if f.Limit < 1 || f.Limit > 1000 {
		badRequest(c, "limit は 1〜1000 で指定してください")
		return
	}
	if f.Offset < 0 {
		badRequest(c, "offset は 0 以上で指定してください")
		return
	}
	preds, err := predicate.ParseParam(c.Query("preds"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	f.Preds = preds

	page, err := s.repo.QueryHistory(c.Request.Context(), f)
	if err != nil {
		var ve *predicate.ValidationError
		if errors.As(err, &ve) {
			badRequest(c, ve.Msg)
			return
		}
		internalError(c, "history", err, "履歴の取得に失敗しました")
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

// GetHistoryOverflow は 1MB を超えて MinIO へ退避された detail 全文を返す。
// ブラウザに直接ストレージを触らせず,backend がサーバーサイドで取得する。
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
		internalError(c, "history overflow", err, "履歴の取得に失敗しました")
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
		internalError(c, "history overflow fetch", err, "全文の取得に失敗しました")
		return
	}
	c.Data(http.StatusOK, "application/json", full)
}

func historyDTO(e repo.HistoryEntry) api.HistoryEntry {
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
