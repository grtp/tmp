// respond: ハンドラが繰り返し書いていた定型(エラー応答・監査記録)をまとめる。
// ここを通すことでログの文言と監査エントリの必須項目が1か所に揃う。
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"f-tool/internal/applog"
	"f-tool/internal/audit"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/session"
)

// badRequest は入力検証エラー(400)。利用者に見せる文言をそのまま渡す。
func badRequest(c *gin.Context, msg string) {
	abortErr(c, http.StatusBadRequest, "validation_failed", msg)
}

// internalError は想定外の失敗(500)。原因はログにだけ残し,利用者へは
// msg だけを返す(SQL 文やホスト名を画面に出さないため)。
// op は「どこで」を示す短い識別子(例 "list users")。
func internalError(c *gin.Context, op string, err error, msg string) {
	applog.From(c.Request.Context()).Error("handler failed", "op", op, "err", err)
	abortErr(c, http.StatusInternalServerError, "internal", msg)
}

// auditOK / auditNG は認証済みハンドラ用の監査記録。実行者(誰が・どこから)は
// gin コンテキストから取るため引数から省き,記録漏れを防ぐ。
func (s *Server) auditOK(c *gin.Context, actionCode, operation, target string, detail any) {
	guid, username := actorFromContext(c)
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultSuccess, "")
}

func (s *Server) auditNG(c *gin.Context, actionCode, operation, target string, detail any, errorCode string) {
	guid, username := actorFromContext(c)
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultFailure, errorCode)
}

// auditAsOK / auditAsNG は実行者を明示する版。ログインのように認証が
// 完了しておらず,コンテキストにまだ claims が無い場面で使う
// (失敗時は GUID すら確定しないため username だけを渡すこともある)。
func (s *Server) auditAsOK(c *gin.Context, guid adguid.GUID, username, actionCode, operation, target string, detail any) {
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultSuccess, "")
}

func (s *Server) auditAsNG(c *gin.Context, guid adguid.GUID, username, actionCode, operation, target string, detail any, errorCode string) {
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultFailure, errorCode)
}

// actorFromContext は claims から実行者を取る。mustClaims と違い panic せず,
// 未認証なら空で返す: 監査の付帯処理がリクエスト本体を落とすべきではない
// (認証前の経路は auditAs* を使うのが正しい)。
func actorFromContext(c *gin.Context) (adguid.GUID, string) {
	v, ok := c.Get(claimsKey)
	if !ok {
		return "", ""
	}
	cl, ok := v.(*session.Claims)
	if !ok {
		return "", ""
	}
	return cl.ObjectGUID, cl.Username
}

func (s *Server) writeAudit(
	c *gin.Context, guid adguid.GUID, username, actionCode, operation, target string,
	detail any, result string, errorCode string,
) {
	s.audits.Write(c.Request.Context(), audit.Entry{
		ObjectGUID: guid,
		Username:   username,
		ActionCode: actionCode,
		Operation:  operation,
		Target:     target,
		Detail:     detail,
		Result:     result,
		ErrorCode:  errorCode,
		ClientIP:   c.ClientIP(),
	})
}
