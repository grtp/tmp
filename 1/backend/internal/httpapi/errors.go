// errors: repo / store の型付きエラーを HTTP ステータスへ写像する。
package httpapi

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"f-tool/internal/conn"
	"f-tool/internal/repo"
	"f-tool/internal/store"
)

// writeStoreError は store の型付きエラーを OpenAPI の Error/BatchError へ写像する。
func (s *Server) writeStoreError(c *gin.Context, err error) {
	var ve *store.ValidationError
	var oe *store.OpError

	switch {
	case errors.As(err, &ve):
		abortErr(c, http.StatusBadRequest, "validation_failed", ve.Msg)
	case errors.As(err, &oe):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"code":    "conflict",
			"message": oe.Msg,
			"details": gin.H{"operation": oe.Op, "index": oe.Index, "reason": oe.Reason},
		})
	case errors.Is(err, conn.ErrDisabled) || conn.IsUnreachable(err):
		abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
	default:
		log.Printf("httpapi: store: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", "処理に失敗しました")
	}
}

// writeRepoError は repo パッケージのエラーを HTTP へ写像する。
func (s *Server) writeRepoError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, repo.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "対象が存在しません")
	case errors.Is(err, repo.ErrConflict):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	default:
		log.Printf("httpapi: admin: %v", err)
		abortErr(c, http.StatusInternalServerError, "internal", fallback)
	}
}
