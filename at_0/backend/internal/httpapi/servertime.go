package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
)

func (s *Server) GetServerTime(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, api.ServerTime{Now: time.Now().UTC().Truncate(time.Millisecond)})
}
