package httpapi

import (
	"encoding/json"
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
		badRequest(c, "管理用名は1〜128文字で指定してください")
		return
	}

	displayName := name
	if req.DisplayName != nil && strings.TrimSpace(*req.DisplayName) != "" {
		displayName = strings.TrimSpace(*req.DisplayName)
	}
	if len([]rune(displayName)) > 128 {
		badRequest(c, "表示名は1〜128文字で指定してください")
		return
	}
	desc := ""
	if req.Description != nil {
		desc = strings.TrimSpace(*req.Description)
	}
	if req.Rank != nil && !validRank(*req.Rank) {
		badRequest(c, rankRangeMessage)
		return
	}

	g, err := s.repo.CreateGroup(c.Request.Context(), name, displayName, desc, req.Rank, cl.Username)
	if err != nil {
		s.writeRepoError(c, err, "グループの作成に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionSettings, "group.create", "group:"+g.Name, gin.H{"id": g.ID, "name": g.Name, "displayName": g.DisplayName})
	c.JSON(http.StatusCreated, groupDTO(*g))
}

func (s *Server) UpdateGroup(c *gin.Context, id api.GroupId) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)

	body, err := c.GetRawData()
	if err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	var req api.GroupUpdate
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &req); err != nil || json.Unmarshal(body, &raw) != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	var name *string
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || len([]rune(n)) > 128 {
			badRequest(c, "管理用名は1〜128文字で指定してください")
			return
		}
		name = &n
	}
	var displayName *string
	if req.DisplayName != nil {
		d := strings.TrimSpace(*req.DisplayName)
		if d == "" || len([]rune(d)) > 128 {
			badRequest(c, "表示名は1〜128文字で指定してください")
			return
		}
		displayName = &d
	}
	var desc *string
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		desc = &d
	}
	_, rankSet := raw["rank"]
	if req.Rank != nil && !validRank(*req.Rank) {
		badRequest(c, rankRangeMessage)
		return
	}

	g, err := s.repo.UpdateGroup(c.Request.Context(), id, name, displayName, desc,
		repo.OptionalRank{Set: rankSet, Value: req.Rank}, cl.Username)
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
	s.auditOK(c, authz.ActionSettings, "group.delete", "group:"+g.Name, gin.H{"id": id, "name": g.Name, "displayName": g.DisplayName})
	c.Status(http.StatusNoContent)
}

func (s *Server) GetGroupGraph(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	groups, err := s.repo.ListGroups(c.Request.Context())
	if err != nil {
		internalError(c, "group graph", err, "グループ構成の取得に失敗しました")
		return
	}
	edges, err := s.repo.ListAllGroupMembers(c.Request.Context())
	if err != nil {
		internalError(c, "group graph", err, "グループ構成の取得に失敗しました")
		return
	}
	nodes := make([]api.GroupNode, 0, len(groups))
	for _, g := range groups {
		n := api.GroupNode{Id: g.ID, Name: g.Name, DisplayName: g.DisplayName, Rank: g.Rank}
		if g.Description != "" {
			n.Description = ptr(g.Description)
		}
		nodes = append(nodes, n)
	}
	out := make([]api.GroupEdge, 0, len(edges))
	for _, e := range edges {
		d := api.GroupEdge{
			GroupId:     e.GroupID,
			SubjectKind: api.SubjectKind(e.Subject.Kind),
			SubjectId:   subjectID(e.Subject),
			Name:        e.Name,
		}
		if e.Username != "" {
			d.Username = ptr(e.Username)
		}
		if e.GroupName != "" {
			d.GroupName = ptr(e.GroupName)
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, api.GroupGraph{Groups: nodes, Edges: out})
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
		if m.GroupName != "" {
			dto.GroupName = ptr(m.GroupName)
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

const rankRangeMessage = "ランクは 0〜99 の整数で指定してください"

func validRank(r int) bool { return r >= 0 && r <= 99 }

func groupDTO(g repo.Group) api.Group {
	out := api.Group{
		Id:          g.ID,
		Name:        g.Name,
		DisplayName: g.DisplayName,
		Rank:        g.Rank,
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
