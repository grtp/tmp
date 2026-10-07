package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

func parseSubject(c *gin.Context, kind api.SubjectKind, id string) (repo.Subject, bool) {
	switch repo.SubjectKind(kind) {
	case repo.SubjectUser:
		u, err := parseUUID(id)
		if err != nil {
			badRequest(c, "subjectId は uuid で指定してください")
			return repo.Subject{}, false
		}
		return repo.Subject{Kind: repo.SubjectUser, ObjectGUID: adguid.GUID(strings.ToLower(u.String()))}, true
	case repo.SubjectGroup:
		n, err := strconv.Atoi(id)
		if err != nil || n <= 0 {
			badRequest(c, "subjectId はグループ ID(正の整数)で指定してください")
			return repo.Subject{}, false
		}
		return repo.Subject{Kind: repo.SubjectGroup, GroupID: n}, true
	default:
		badRequest(c, "subjectKind が不正です")
		return repo.Subject{}, false
	}
}

func subjectID(s repo.Subject) string {
	if s.Kind == repo.SubjectGroup {
		return strconv.Itoa(s.GroupID)
	}
	return string(s.ObjectGUID)
}

func (s *Server) resolveResource(c *gin.Context, rtype api.ResourceType, rid int) (authz.ResourceType, string, bool) {
	t := authz.ResourceType(rtype)
	switch t {
	case authz.ResourceTypeManagedTable:
		m, err := s.repo.GetManagedTable(c.Request.Context(), rid)
		if err != nil {
			s.writeRepoError(c, err, "テーブルの取得に失敗しました")
			return "", "", false
		}
		return t, auditTarget(m.ConnectionName, m.SchemaName, m.TableName), true
	case authz.ResourceTypePwchangeTarget:
		pt, err := s.pwchange.Repo().Get(c.Request.Context(), rid)
		if err != nil {
			s.writePwchangeError(c, err, "変更先の取得に失敗しました")
			return "", "", false
		}
		return t, pwcTarget(pt), true
	case authz.ResourceTypeAction:
		a, err := s.repo.GetAction(c.Request.Context(), rid)
		if err != nil {
			s.writeRepoError(c, err, "機能の取得に失敗しました")
			return "", "", false
		}
		return t, "action:" + a.Code, true
	default:
		badRequest(c, "resourceType が不正です")
		return "", "", false
	}
}

func (s *Server) ListResourceAuth(c *gin.Context, resourceType api.ResourceType, resourceId api.ResourceId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	rtype, _, ok := s.resolveResource(c, resourceType, resourceId)
	if !ok {
		return
	}
	list, err := s.repo.ListResourceAuth(c.Request.Context(), rtype, resourceId)
	if err != nil {
		internalError(c, "list resource auth", err, "アクセス許可の取得に失敗しました")
		return
	}
	entries := make([]api.ResourceAuthEntry, 0, len(list))
	for _, e := range list {
		entries = append(entries, resourceAuthEntryDTO(e))
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (s *Server) SetResourceAuth(c *gin.Context, resourceType api.ResourceType, resourceId api.ResourceId, subjectKind api.SubjectKind, subjectId api.SubjectId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.SetResourceAuthJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	level := authz.ResourceLevel(req.AuthLevel)
	if !level.Valid() {
		badRequest(c, "authLevel が不正です")
		return
	}
	subj, ok := parseSubject(c, subjectKind, subjectId)
	if !ok {
		return
	}
	rtype, target, ok := s.resolveResource(c, resourceType, resourceId)
	if !ok {
		return
	}

	entry, err := s.repo.SetResourceAuth(c.Request.Context(), rtype, resourceId, subj, level, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "アクセス許可の更新に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "resource-auth.set", target,
		gin.H{"resourceType": string(rtype), "resourceId": resourceId,
			"subjectKind": string(subj.Kind), "subjectId": subjectID(subj), "authLevel": string(level)})
	c.JSON(http.StatusOK, resourceAuthEntryDTO(*entry))
}

func (s *Server) DeleteResourceAuth(c *gin.Context, resourceType api.ResourceType, resourceId api.ResourceId, subjectKind api.SubjectKind, subjectId api.SubjectId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	subj, ok := parseSubject(c, subjectKind, subjectId)
	if !ok {
		return
	}
	rtype, target, ok := s.resolveResource(c, resourceType, resourceId)
	if !ok {
		return
	}
	if err := s.repo.DeleteResourceAuth(c.Request.Context(), rtype, resourceId, subj); err != nil {
		s.writeRepoError(c, err, "アクセス許可の削除に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "resource-auth.delete", target,
		gin.H{"resourceType": string(rtype), "resourceId": resourceId,
			"subjectKind": string(subj.Kind), "subjectId": subjectID(subj)})
	c.Status(http.StatusNoContent)
}

func resourceAuthEntryDTO(e repo.ResourceAuthEntry) api.ResourceAuthEntry {
	out := api.ResourceAuthEntry{
		SubjectKind: api.SubjectKind(e.Subject.Kind),
		SubjectId:   subjectID(e.Subject),
		Name:        e.Name,
		AuthLevel:   api.ResourceAuthLevel(e.AuthLevel),
	}
	if e.Username != "" {
		out.Username = ptr(e.Username)
	}
	return out
}
