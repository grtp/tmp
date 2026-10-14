package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

func (s *Server) ListGroups(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.repo.ListGroups(c.Request.Context())
	if err != nil {
		internalError(c, "list groups", err, "グループ一覧の取得に失敗しました")
		return
	}
	out := make([]api.Group, 0, len(list))
	for _, g := range list {
		out = append(out, groupDTO(g))
	}
	c.JSON(http.StatusOK, gin.H{"groups": out})
}

func (s *Server) GetGroup(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	g, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "グループの取得に失敗しました")
		return
	}
	c.JSON(http.StatusOK, groupDTO(*g))
}

func (s *Server) CreateGroup(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.GroupCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 128 {
		badRequest(c, "name は1〜128文字で指定してください")
		return
	}
	desc := ""
	if req.Description != nil {
		desc = strings.TrimSpace(*req.Description)
	}

	g, err := s.repo.CreateGroup(c.Request.Context(), name, desc, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "グループの作成に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group.create", "group:"+g.Name, gin.H{"id": g.ID, "name": g.Name})
	c.JSON(http.StatusCreated, groupDTO(*g))
}

func (s *Server) UpdateGroup(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.GroupUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	var name *string
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || len([]rune(n)) > 128 {
			badRequest(c, "name は1〜128文字で指定してください")
			return
		}
		name = &n
	}
	var desc *string
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		desc = &d
	}

	g, err := s.repo.UpdateGroup(c.Request.Context(), id, name, desc, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "グループの更新に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group.update", "group:"+g.Name, req)
	c.JSON(http.StatusOK, groupDTO(*g))
}

func (s *Server) DeleteGroup(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	g, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "グループの取得に失敗しました")
		return
	}
	if err := s.repo.DeleteGroup(c.Request.Context(), id, s.lockoutGuard(c)); err != nil {
		s.writeRepoError(c, err, "グループの削除に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group.delete", "group:"+g.Name, gin.H{"id": id, "name": g.Name})
	c.Status(http.StatusNoContent)
}

func (s *Server) ListGroupMembers(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.repo.ListGroupMembers(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "所属一覧の取得に失敗しました")
		return
	}
	out := make([]api.GroupMember, 0, len(list))
	for _, m := range list {
		dto := api.GroupMember{
			SubjectKind: api.SubjectKind(m.Subject.Kind),
			SubjectId:   subjectID(m.Subject),
			Name:        m.Name,
		}
		if m.Username != "" {
			dto.Username = ptr(m.Username)
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, gin.H{"members": out})
}

func (s *Server) AddGroupMember(c *gin.Context, id api.GroupId, subjectKind api.SubjectKind, subjectId api.SubjectId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	subj, ok := parseSubject(c, subjectKind, subjectId)
	if !ok {
		return
	}
	g, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "グループの取得に失敗しました")
		return
	}
	if err := s.repo.AddGroupMember(c.Request.Context(), id, subj, cl.Username); err != nil {
		s.writeRepoError(c, err, "所属の追加に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group-member.add", "group:"+g.Name,
		gin.H{"groupId": id, "subjectKind": string(subj.Kind), "subjectId": subjectID(subj)})
	c.Status(http.StatusNoContent)
}

func (s *Server) RemoveGroupMember(c *gin.Context, id api.GroupId, subjectKind api.SubjectKind, subjectId api.SubjectId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	subj, ok := parseSubject(c, subjectKind, subjectId)
	if !ok {
		return
	}
	g, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "グループの取得に失敗しました")
		return
	}
	if err := s.repo.RemoveGroupMember(c.Request.Context(), id, subj, s.lockoutGuard(c)); err != nil {
		s.writeRepoError(c, err, "所属の解除に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group-member.remove", "group:"+g.Name,
		gin.H{"groupId": id, "subjectKind": string(subj.Kind), "subjectId": subjectID(subj)})
	c.Status(http.StatusNoContent)
}

func (s *Server) SetGroupAuth(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	var req api.SetGroupAuthJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	assignments := make([]repo.AuthAssignment, 0, len(req.Assignments))
	for _, a := range req.Assignments {
		lvl := authz.Level(a.AuthLevel)
		if !lvl.Valid() {
			badRequest(c, "authLevel が不正です")
			return
		}
		assignments = append(assignments, repo.AuthAssignment{ActionID: a.ActionId, AuthLevel: lvl})
	}

	current, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "グループの取得に失敗しました")
		return
	}
	if err := s.repo.ReplaceGroupAuth(c.Request.Context(), id, assignments, cl.Username, s.lockoutGuard(c)); err != nil {
		s.writeRepoError(c, err, "権限の更新に失敗しました")
		return
	}
	updated, err := s.repo.GetGroup(c.Request.Context(), id)
	if err != nil {
		s.writeRepoError(c, err, "更新後の取得に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group-auth.replace", "group:"+updated.Name,
		gin.H{"groupId": id, "before": auditAuthEntries(current.Auth), "after": auditAuthEntries(updated.Auth)})
	c.JSON(http.StatusOK, groupDTO(*updated))
}

func groupDTO(g repo.Group) api.Group {
	out := api.Group{
		Id:          g.ID,
		Name:        g.Name,
		MemberCount: g.MemberCount,
		UpdatedAt:   g.UpdatedAt,
		Auth:        make([]api.UserAuthEntry, 0, len(g.Auth)),
	}
	if g.Description != "" {
		out.Description = ptr(g.Description)
	}
	for _, a := range g.Auth {
		out.Auth = append(out.Auth, api.UserAuthEntry{
			ActionId: a.ActionID, ActionCode: a.ActionCode, AuthLevel: api.AuthLevel(a.AuthLevel),
		})
	}
	return out
}
