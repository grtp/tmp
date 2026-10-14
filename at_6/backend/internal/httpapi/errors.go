package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"f-tool/internal/conn"
	"f-tool/internal/repo"
	"f-tool/internal/store"
)

func (s *Server) writeStoreError(c *gin.Context, err error) {
	var ve *store.ValidationError
	var oe *store.OpError

	switch {
	case errors.As(err, &ve):
		badRequest(c, ve.Msg)
	case errors.As(err, &oe):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"code":    "conflict",
			"message": oe.Msg,
			"details": gin.H{"operation": oe.Op, "index": oe.Index, "reason": oe.Reason},
		})
	case errors.Is(err, conn.ErrDisabled) || conn.IsUnreachable(err):
		abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
	default:
		internalError(c, "store", err, "処理に失敗しました")
	}
}

func (s *Server) writeRepoError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, repo.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "対象が存在しません")
	case errors.Is(err, repo.ErrConflict):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	default:
		internalError(c, "admin", err, fallback)
	}
}
