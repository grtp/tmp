package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/auth"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"
)

const (
	defaultDirectorySearchLimit = 150
	maxDirectorySearchLimit     = 1000
)

func (s *Server) searchLimit() int {
	n := s.directorySearchLimit
	if n <= 0 {
		n = defaultDirectorySearchLimit
	}
	if n > maxDirectorySearchLimit {
		n = maxDirectorySearchLimit
	}
	return n
}

func (s *Server) SearchDirectoryUsers(c *gin.Context, params api.SearchDirectoryUsersParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if s.directory == nil {
		abortErr(c, http.StatusServiceUnavailable, "directory_unavailable", "ディレクトリ検索は利用できません")
		return
	}
	q := strings.TrimSpace(params.Q)
	if len([]rune(q)) < 2 {
		badRequest(c, "検索語は 2 文字以上で指定してください")
		return
	}
	limit := s.searchLimit()
	found, err := s.directory.SearchUsers(q, limit)
	if err != nil {
		applog.From(c.Request.Context()).Error("directory search failed", "err", err)
		abortErr(c, http.StatusBadGateway, "ldap_unavailable", "ディレクトリの検索に失敗しました")
		return
	}

	truncated := len(found) >= limit
	if s.directorySearchRequireEmployeeNo {
		kept := found[:0]
		for _, id := range found {
			if id.EmployeeNo != "" {
				kept = append(kept, id)
			}
		}
		found = kept
	}
	guids := make([]adguid.GUID, 0, len(found))
	for _, id := range found {
		guids = append(guids, id.ObjectGUID)
	}
	existing, err := s.repo.ExistingUserGUIDs(c.Request.Context(), guids)
	if err != nil {
		internalError(c, "directory existing", err, "台帳の照合に失敗しました")
		return
	}
	out := make([]api.DirectoryUser, 0, len(found))
	for _, id := range found {
		guid, err := parseUUID(string(id.ObjectGUID))
		if err != nil {
			continue
		}
		d := api.DirectoryUser{
			ObjectGuid:  guid,
			Username:    id.Username,
			DisplayName: id.DisplayName,
			Registered:  existing[id.ObjectGUID],
		}
		if id.Email != "" {
			d.Email = ptr(id.Email)
		}
		if id.Department != "" {
			d.Department = ptr(id.Department)
		}
		if id.Title != "" {
			d.Title = ptr(id.Title)
		}
		if id.EmployeeNo != "" {
			d.EmployeeNo = ptr(id.EmployeeNo)
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, api.DirectoryUserList{Users: out, Limit: limit, Truncated: truncated})
}

func (s *Server) RegisterUser(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	if s.directory == nil {
		abortErr(c, http.StatusServiceUnavailable, "directory_unavailable", "ディレクトリ検索は利用できません")
		return
	}
	var req api.UserRegister
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		badRequest(c, "ユーザー ID を指定してください")
		return
	}
	id, err := s.directory.LookupUser(username)
	if errors.Is(err, auth.ErrUserNotFound) {
		abortErr(c, http.StatusNotFound, "not_found", "ディレクトリに該当するユーザーがいません")
		return
	}
	if err != nil {
		applog.From(c.Request.Context()).Error("directory lookup failed", "err", err)
		abortErr(c, http.StatusBadGateway, "ldap_unavailable", "ディレクトリの照会に失敗しました")
		return
	}
	if string(id.ObjectGUID) != strings.ToLower(req.ObjectGuid.String()) {
		abortErr(c, http.StatusConflict, "conflict", "ディレクトリの情報が変わっています。検索し直してください")
		return
	}
	ctx := c.Request.Context()
	if err := s.resolver.UpsertUser(ctx, id, false); err != nil {
		internalError(c, "register user", err, "ユーザーの登録に失敗しました")
		return
	}
	u, err := s.repo.GetUser(ctx, id.ObjectGUID)
	if err != nil {
		internalError(c, "register user get", err, "登録後の取得に失敗しました")
		return
	}
	dto, err := userDTO(*u)
	if err != nil {
		internalError(c, "register user dto", err, "登録後の取得に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "user.register", "user:"+id.Username,
		gin.H{"objectGuid": string(id.ObjectGUID), "username": id.Username, "department": id.Department})
	c.JSON(http.StatusCreated, dto)
}
