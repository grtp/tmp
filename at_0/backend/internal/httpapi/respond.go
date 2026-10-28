package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"f-tool/internal/applog"
	"f-tool/internal/audit"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/session"
)

func badRequest(c *gin.Context, msg string) {
	abortErr(c, http.StatusBadRequest, "validation_failed", msg)
}

func internalError(c *gin.Context, op string, err error, msg string) {
	applog.From(c.Request.Context()).Error("handler failed", "op", op, "err", err)
	abortErr(c, http.StatusInternalServerError, "internal", msg)
}

func (s *Server) auditOK(c *gin.Context, actionCode, operation, target string, detail any) {
	guid, username := actorFromContext(c)
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultSuccess, "")
}

func (s *Server) auditNG(c *gin.Context, actionCode, operation, target string, detail any, errorCode string) {
	guid, username := actorFromContext(c)
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultFailure, errorCode)
}

func (s *Server) auditAsOK(c *gin.Context, guid adguid.GUID, username, actionCode, operation, target string, detail any) {
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultSuccess, "")
}

func (s *Server) auditAsNG(c *gin.Context, guid adguid.GUID, username, actionCode, operation, target string, detail any, errorCode string) {
	s.writeAudit(c, guid, username, actionCode, operation, target, detail, audit.ResultFailure, errorCode)
}

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
