package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/applog"
	"f-tool/internal/authz"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
	"f-tool/internal/pwchange"
)

func pwcTarget(t *pwchange.Target) string { return "conn:" + t.ConnectionName }

func (s *Server) canUsePwchangeTarget(c *gin.Context, targetID int) bool {
	if featureAdmin(c, authz.ActionPwChange) {
		return true
	}
	return mustResourceGrants(c).AllowsPwchangeTarget(targetID)
}

func (s *Server) usableTarget(c *gin.Context, id int) *pwchange.Target {
	t, err := s.pwchange.Repo().Get(c.Request.Context(), id)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の取得に失敗しました")
		return nil
	}
	if !t.Usable() || !s.canUsePwchangeTarget(c, t.ID) {
		abortErr(c, http.StatusNotFound, "not_found", "この変更先は現在利用できません")
		return nil
	}
	return t
}

func requireEmployeeNo(c *gin.Context) string {
	no := strings.TrimSpace(mustClaims(c).EmployeeNo)
	if no == "" {
		abortErr(c, http.StatusBadRequest, "validation_failed",
			"あなたのアカウントに社員番号が登録されていないため,この機能は利用できません")
	}
	return no
}

func (s *Server) ListPwchangeTargets(c *gin.Context) {
	if !s.require(c, authz.ActionPwChange, authz.LevelUser) {
		return
	}
	cl := mustClaims(c)
	ctx := c.Request.Context()
	list, err := s.pwchange.Repo().List(ctx)
	if err != nil {
		internalError(c, "pwchange list", err, "変更先の取得に失敗しました")
		return
	}
	employeeNo := strings.TrimSpace(cl.EmployeeNo)
	consented := map[int]struct{}{}
	if employeeNo != "" {
		consented, err = s.pwchange.Repo().ConsentedTargets(ctx, cl.ObjectGUID, employeeNo)
		if err != nil {
			internalError(c, "pwchange consents", err, "変更先の取得に失敗しました")
			return
		}
	}
	out := make([]api.PwchangeTargetSummary, 0, len(list))
	for i := range list {
		t := &list[i]
		if !t.Usable() || !s.canUsePwchangeTarget(c, t.ID) {
			continue
		}
		locked, retry, err := s.pwchange.Lockout().Status(ctx, t.ID, string(cl.ObjectGUID))
		if err != nil {
			applog.From(ctx).Error("pwchange lock status failed", "err", err)
			abortErr(c, http.StatusServiceUnavailable, "session_unavailable", "試行回数の確認に失敗しました")
			return
		}
		d := api.PwchangeTargetSummary{
			Id:             t.ID,
			ConnectionId:   t.ConnectionID,
			ConnectionName: t.ConnectionName,
			Locked:         locked,
			MaxFailures:    t.MaxFailures,
			LockMinutes:    t.LockMinutes,
			Policy:         policyDTO(t.Policy),
		}
		if t.ConnectionColor != "" {
			d.ConnectionColor = ptr(t.ConnectionColor)
		}
		if _, ok := consented[t.ID]; ok {
			d.Consented = true
		}
		if locked {
			d.LockRemainingSec = ptr(int(retry.Seconds()) + 1)
		}
		out = append(out, d)
	}
	res := api.PwchangeTargetList{Targets: out}
	if employeeNo != "" {
		res.EmployeeNo = ptr(employeeNo)
	}
	c.JSON(http.StatusOK, res)
}

func (s *Server) LookupPwchangeAccount(c *gin.Context, id int) {
	if !s.require(c, authz.ActionPwChange, authz.LevelUser) {
		return
	}
	no := requireEmployeeNo(c)
	if no == "" {
		return
	}
	t := s.usableTarget(c, id)
	if t == nil {
		return
	}
	acct, err := s.pwchange.Lookup(c.Request.Context(), t, no)
	if err != nil {
		s.writePwchangeError(c, err, "アカウントの引き当てに失敗しました")
		return
	}
	c.JSON(http.StatusOK, lookupDTO(acct))
}

func (s *Server) ConsentPwchangeAccount(c *gin.Context, id int) {
	if !s.require(c, authz.ActionPwChange, authz.LevelUser) {
		return
	}
	no := requireEmployeeNo(c)
	if no == "" {
		return
	}
	t := s.usableTarget(c, id)
	if t == nil {
		return
	}
	cl := mustClaims(c)
	acct, err := s.pwchange.Lookup(c.Request.Context(), t, no)
	if err != nil {
		s.writePwchangeError(c, err, "アカウントの引き当てに失敗しました")
		return
	}
	if acct.Matched != 1 {
		abortErr(c, http.StatusConflict, "conflict", lookupProblem(acct.Matched))
		return
	}
	if err := s.pwchange.Repo().SetConsent(c.Request.Context(), t.ID, cl.ObjectGUID, no); err != nil {
		internalError(c, "pwchange consent", err, "同意の記録に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionPwChange, "pwchange.consent", pwcTarget(t), gin.H{"targetId": t.ID, "accountName": acct.Name})
	c.Status(http.StatusNoContent)
}

func (s *Server) ChangePwchangePassword(c *gin.Context, id int) {
	if !s.require(c, authz.ActionPwChange, authz.LevelUser) {
		return
	}
	no := requireEmployeeNo(c)
	if no == "" {
		return
	}
	t := s.usableTarget(c, id)
	if t == nil {
		return
	}
	cl := mustClaims(c)
	var req api.PwchangeChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.CurrentPassword == "" || req.NewPassword == "" {
		badRequest(c, "現在のパスワードと新しいパスワードを入力してください")
		return
	}
	ctx := c.Request.Context()
	ok, err := s.pwchange.Repo().HasConsent(ctx, t.ID, cl.ObjectGUID, no)
	if err != nil {
		internalError(c, "pwchange has consent", err, "同意の確認に失敗しました")
		return
	}
	if !ok {
		abortErr(c, http.StatusConflict, "consent_required", "先にアカウントの確認を行ってください")
		return
	}
	detail := gin.H{"targetId": t.ID}
	acct, err := s.pwchange.Change(ctx, t, string(cl.ObjectGUID), no, req.CurrentPassword, req.NewPassword,
		[]string{no, cl.Username})
	if err != nil {
		s.handleChangeError(c, t, "pwchange.change", detail, err)
		return
	}
	detail["accountName"] = acct.Name
	s.auditOK(c, authz.ActionPwChange, "pwchange.change", pwcTarget(t), detail)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleChangeError(c *gin.Context, t *pwchange.Target, op string, detail gin.H, err error) {
	var me *pwchange.MismatchError
	var le *pwchange.LockedError
	var pe *pwchange.PolicyError
	switch {
	case errors.As(err, &me):
		detail["remaining"] = me.Remaining
		detail["lockedNow"] = me.Locked
		s.auditNG(c, authz.ActionPwChange, op, pwcTarget(t), detail, "password_mismatch")
		if me.Alert {

			s.auditNG(c, authz.ActionPwChange, "pwchange.alert", pwcTarget(t),
				gin.H{"targetId": t.ID, "recentFailures": me.TargetFailures,
					"threshold": s.pwchange.Lockout().AlertThreshold()}, "too_many_failures")
		}
		msg := "現在のパスワードが一致しません"
		if me.Locked {
			msg = fmt.Sprintf("現在のパスワードが一致しません。失敗が続いたため %d 分間ロックします", t.LockMinutes)
		} else {
			msg = fmt.Sprintf("現在のパスワードが一致しません(あと %d 回失敗すると %d 分間ロックされます)", me.Remaining, t.LockMinutes)
		}
		c.AbortWithStatusJSON(http.StatusBadRequest, api.Error{
			Code: api.ErrorCodePasswordMismatch, Message: msg,
			Details: &map[string]any{"remaining": me.Remaining, "locked": me.Locked},
		})
	case errors.As(err, &le):
		s.auditNG(c, authz.ActionPwChange, op, pwcTarget(t), detail, "locked")
		sec := int(le.RetryAfter.Seconds()) + 1
		c.AbortWithStatusJSON(http.StatusLocked, api.Error{
			Code:    api.ErrorCodeLocked,
			Message: fmt.Sprintf("失敗が続いたためロック中です。あと %d 分お待ちください", (sec+59)/60),
			Details: &map[string]any{"retryAfterSec": sec},
		})
	case errors.As(err, &pe):
		vios := make([]string, 0, len(pe.Violations))
		for _, v := range pe.Violations {
			vios = append(vios, string(v))
		}
		c.AbortWithStatusJSON(http.StatusBadRequest, api.Error{
			Code: api.ErrorCodeValidationFailed, Message: "新しいパスワードがポリシーを満たしていません: " + pe.Error(),
			Details: &map[string]any{"violations": vios},
		})
	case errors.Is(err, pwchange.ErrNoAccount), errors.Is(err, pwchange.ErrAmbiguous):
		s.auditNG(c, authz.ActionPwChange, op, pwcTarget(t), detail, "account_not_found")
		abortErr(c, http.StatusConflict, "conflict", lookupProblem(map[bool]int{true: 0, false: 2}[errors.Is(err, pwchange.ErrNoAccount)]))
	case errors.Is(err, pwchange.ErrRace):
		s.auditNG(c, authz.ActionPwChange, op, pwcTarget(t), detail, "conflict")
		abortErr(c, http.StatusConflict, "conflict", "照合後にパスワードが別の操作で変更されました。もう一度やり直してください")
	default:
		s.auditNG(c, authz.ActionPwChange, op, pwcTarget(t), detail, "internal")
		s.writePwchangeError(c, err, "パスワードの変更に失敗しました")
	}
}

func lookupProblem(matched int) string {
	if matched == 0 {
		return "あなたの社員番号に一致するアカウントが見つかりません"
	}
	return "あなたの社員番号に一致するアカウントが複数あるため処理できません。管理者に連絡してください"
}

func lookupDTO(a *pwchange.Account) api.PwchangeLookupResult {
	out := api.PwchangeLookupResult{Matched: a.Matched}
	if a.Matched == 1 && a.Name != "" {
		out.Name = ptr(a.Name)
	}
	return out
}

func (s *Server) ListPwchangeAdminTargets(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	ctx := c.Request.Context()
	list, err := s.pwchange.Repo().List(ctx)
	if err != nil {
		internalError(c, "pwchange admin list", err, "変更先の取得に失敗しました")
		return
	}
	out := make([]api.PwchangeTarget, 0, len(list))
	for i := range list {
		n, err := s.pwchange.Lockout().TargetFailures(ctx, list[i].ID)
		if err != nil {
			applog.From(ctx).Warn("pwchange target failures", "err", err)
		}
		out = append(out, targetDTO(&list[i], n))
	}
	c.JSON(http.StatusOK, gin.H{"targets": out, "alertThreshold": s.pwchange.Lockout().AlertThreshold()})
}

func (s *Server) CreatePwchangeTarget(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	var req api.PwchangeTargetCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.Salt != nil && *req.Salt == "" {
		badRequest(c, "ソルトを空にはできません")
		return
	}

	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(req.TableName)), "ftool_app_") {
		badRequest(c, "ftool_app_ で始まるテーブルは指定できません")
		return
	}
	recipe := recipeFromDTO(req.Recipe)
	if err := recipe.Validate(); err != nil {
		badRequest(c, err.Error())
		return
	}
	policy := pwchange.Policy{MinLen: 8, MaxLen: 64, MinClasses: 2, ASCIIOnly: true, ForbidSame: true, ForbidIdentity: true}
	if req.Policy != nil {
		policy = policyFromDTO(*req.Policy)
	}
	if err := policy.Validate(); err != nil {
		badRequest(c, err.Error())
		return
	}
	cn, err := s.conns.Get(c.Request.Context(), req.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}
	if cn.SchemaName != "" && !strings.EqualFold(strings.TrimSpace(req.SchemaName), cn.SchemaName) {
		badRequest(c, fmt.Sprintf("この接続では %s スキーマのテーブルのみ指定できます", cn.SchemaName))
		return
	}
	ins, ok := s.pwchangeIntrospect(c, req.ConnectionId, req.SchemaName, req.TableName)
	if !ok {
		return
	}
	nameCol := ""
	if req.NameColumn != nil {
		nameCol = *req.NameColumn
	}
	idCol, pwCol, nameCol, err := pwchange.ValidateColumns(ins, req.IdColumn, req.PasswordColumn, nameCol, recipe)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	fxJSON, err := pwchangeFixedJSON(ins, req.FixedColumns, idCol, pwCol)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	p := pwchange.TargetParams{
		ConnectionID:   req.ConnectionId,
		Schema:         ins.Schema,
		Table:          ins.Table,
		IDColumn:       idCol,
		PasswordColumn: pwCol,
		NameColumn:     nameCol,
		FixedJSON:      fxJSON,
		Recipe:         recipe,
		Policy:         policy,
		MaxFailures:    5,
		LockMinutes:    15,
		Enabled:        true,
		Actor:          cl.Username,
	}
	if req.MaxFailures != nil {
		p.MaxFailures = *req.MaxFailures
	}
	if req.LockMinutes != nil {
		p.LockMinutes = *req.LockMinutes
	}
	if msg := validateLockSettings(p.MaxFailures, p.LockMinutes); msg != "" {
		badRequest(c, msg)
		return
	}
	if req.Salt != nil {
		p.Salt = *req.Salt
	}
	if req.TestAccountId != nil {
		p.TestAccountID = strings.TrimSpace(*req.TestAccountId)
	}
	if req.Enabled != nil {
		p.Enabled = *req.Enabled
	}
	created, err := s.pwchange.Repo().Create(c.Request.Context(), p)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の登録に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionPwChange, "pwchange.target.create", pwcTarget(created),
		gin.H{"id": created.ID, "table": created.Schema + "." + created.Table, "idColumn": created.IDColumn,
			"passwordColumn": created.PasswordColumn, "algorithm": created.Recipe.Algorithm, "saltSet": created.SaltSet})
	c.JSON(http.StatusCreated, targetDTO(created, 0))
}

func (s *Server) UpdatePwchangeTarget(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	var req api.PwchangeTargetUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.Salt != nil && *req.Salt == "" {
		badRequest(c, "ソルトを空にはできません")
		return
	}
	cur, err := s.pwchange.Repo().Get(c.Request.Context(), id)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の取得に失敗しました")
		return
	}

	u := pwchange.TargetUpdate{
		MaxFailures: req.MaxFailures, LockMinutes: req.LockMinutes,
		Salt: req.Salt, Enabled: req.Enabled,
	}
	if req.TestAccountId != nil {
		t := strings.TrimSpace(*req.TestAccountId)
		u.TestAccountID = &t
	}
	recipe := cur.Recipe
	if req.Recipe != nil {
		recipe = recipeFromDTO(*req.Recipe)
		if err := recipe.Validate(); err != nil {
			badRequest(c, err.Error())
			return
		}
		u.Recipe = &recipe
	}
	if req.Policy != nil {
		p := policyFromDTO(*req.Policy)
		if err := p.Validate(); err != nil {
			badRequest(c, err.Error())
			return
		}
		u.Policy = &p
	}
	maxF, lockM := cur.MaxFailures, cur.LockMinutes
	if req.MaxFailures != nil {
		maxF = *req.MaxFailures
	}
	if req.LockMinutes != nil {
		lockM = *req.LockMinutes
	}
	if msg := validateLockSettings(maxF, lockM); msg != "" {
		badRequest(c, msg)
		return
	}

	if req.IdColumn != nil || req.PasswordColumn != nil || req.NameColumn != nil || req.FixedColumns != nil || req.Recipe != nil {
		ins, ok := s.pwchangeIntrospect(c, cur.ConnectionID, cur.Schema, cur.Table)
		if !ok {
			return
		}
		idCol, pwCol, nameCol := cur.IDColumn, cur.PasswordColumn, cur.NameColumn
		if req.IdColumn != nil {
			idCol = *req.IdColumn
		}
		if req.PasswordColumn != nil {
			pwCol = *req.PasswordColumn
		}
		if req.NameColumn != nil {
			nameCol = *req.NameColumn
		}
		idCol, pwCol, nameCol, err = pwchange.ValidateColumns(ins, idCol, pwCol, nameCol, recipe)
		if err != nil {
			badRequest(c, err.Error())
			return
		}
		u.IDColumn, u.PasswordColumn, u.NameColumn = &idCol, &pwCol, &nameCol
		if req.FixedColumns != nil {
			fxJSON, err := pwchangeFixedJSON(ins, req.FixedColumns, idCol, pwCol)
			if err != nil {
				badRequest(c, err.Error())
				return
			}
			u.FixedJSON = &fxJSON
		}
	}

	updated, err := s.pwchange.Repo().Update(c.Request.Context(), id, u, cl.Username)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の更新に失敗しました")
		return
	}
	detail := gin.H{"id": id, "saltChanged": req.Salt != nil, "recipeChanged": req.Recipe != nil,
		"policyChanged": req.Policy != nil}
	if req.Enabled != nil {
		detail["enabled"] = *req.Enabled
	}
	s.auditOK(c, authz.ActionPwChange, "pwchange.target.update", pwcTarget(updated), detail)
	if req.Salt != nil {

		s.auditOK(c, authz.ActionPwChange, "pwchange.salt.set", pwcTarget(updated), gin.H{"id": id})
	}
	n, _ := s.pwchange.Lockout().TargetFailures(c.Request.Context(), id)
	c.JSON(http.StatusOK, targetDTO(updated, n))
}

func (s *Server) DeletePwchangeTarget(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	t, err := s.pwchange.Repo().Get(c.Request.Context(), id)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の削除に失敗しました")
		return
	}
	if err := s.pwchange.Repo().Delete(c.Request.Context(), id); err != nil {
		s.writePwchangeError(c, err, "変更先の削除に失敗しました")
		return
	}
	s.auditOK(c, authz.ActionPwChange, "pwchange.target.delete", pwcTarget(t),
		gin.H{"id": id, "table": t.Schema + "." + t.Table})
	c.Status(http.StatusNoContent)
}

func (s *Server) TestPwchangeTarget(c *gin.Context, id int) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cl := mustClaims(c)
	var req api.PwchangeTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "リクエスト形式が不正です")
		return
	}
	if req.CurrentPassword == "" {
		badRequest(c, "現在のパスワードを入力してください")
		return
	}
	t, err := s.pwchange.Repo().Get(c.Request.Context(), id)
	if err != nil {
		s.writePwchangeError(c, err, "変更先の取得に失敗しました")
		return
	}
	if !t.SaltSet {
		badRequest(c, "ソルトが未設定のため照合できません")
		return
	}
	var accountID, subject string
	switch req.Account {
	case api.Self:
		accountID = strings.TrimSpace(cl.EmployeeNo)
		if accountID == "" {
			badRequest(c, "あなたのアカウントに社員番号が登録されていません。テスト用アカウントを使ってください")
			return
		}
		subject = string(cl.ObjectGUID)
	case api.Test:
		accountID = t.TestAccountID
		if accountID == "" {
			badRequest(c, "テスト用アカウントが登録されていません")
			return
		}
		subject = "test:" + accountID
	default:
		badRequest(c, "account は self か test を指定してください")
		return
	}
	acct, err := s.pwchange.Verify(c.Request.Context(), t, subject, accountID, req.CurrentPassword)
	res := api.PwchangeTestResult{}
	if acct != nil {
		res.Matched = acct.Matched
		if acct.Matched == 1 {
			res.Name = ptr(acct.Name)
		}
	}
	detail := gin.H{"id": id, "account": string(req.Account)}
	switch {
	case err == nil:
		res.PasswordOk = true
		res.Message = ptr("一致しました。更新は行っていません")
		s.auditOK(c, authz.ActionPwChange, "pwchange.test", pwcTarget(t), detail)
	case errors.Is(err, pwchange.ErrNoAccount):
		res.Message = ptr("ID 列に一致する行がありません。ID 列の選択や社員番号の形式(ゼロ埋め等)を確認してください")
		s.auditNG(c, authz.ActionPwChange, "pwchange.test", pwcTarget(t), detail, "account_not_found")
	case errors.Is(err, pwchange.ErrAmbiguous):
		res.Message = ptr("ID 列に一致する行が 2 件以上あります。ID 列が一意ではありません")
		s.auditNG(c, authz.ActionPwChange, "pwchange.test", pwcTarget(t), detail, "ambiguous")
	default:
		var me *pwchange.MismatchError
		if errors.As(err, &me) {
			res.Remaining = ptr(me.Remaining)
			res.Message = ptr("パスワードが一致しません。レシピ(アルゴリズム・テンプレート・エンコーディング・出力形式)かソルトが違う可能性があります")
			if me.Locked {
				res.Message = ptr("パスワードが一致しません。失敗が続いたためこのアカウントのテストは一時的にロックされました")
			}
			s.auditNG(c, authz.ActionPwChange, "pwchange.test", pwcTarget(t), detail, "password_mismatch")
			break
		}
		var le *pwchange.LockedError
		if errors.As(err, &le) {
			sec := int(le.RetryAfter.Seconds()) + 1
			c.AbortWithStatusJSON(http.StatusLocked, api.Error{
				Code:    api.ErrorCodeLocked,
				Message: fmt.Sprintf("失敗が続いたためロック中です。あと %d 分お待ちください", (sec+59)/60),
				Details: &map[string]any{"retryAfterSec": sec},
			})
			return
		}
		s.writePwchangeError(c, err, "照合テストに失敗しました")
		return
	}
	c.JSON(http.StatusOK, res)
}

func (s *Server) ListPwchangeConnections(c *gin.Context) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	list, err := s.conns.List(c.Request.Context())
	if err != nil {
		internalError(c, "pwchange connections", err, "接続一覧の取得に失敗しました")
		return
	}
	out := make([]api.PwchangeConnection, 0, len(list))
	for _, x := range list {
		d := api.PwchangeConnection{Id: x.ID, Name: x.Name, Enabled: x.Enabled}
		if x.Color != "" {
			d.Color = ptr(x.Color)
		}
		if x.SchemaName != "" {
			d.SchemaName = ptr(x.SchemaName)
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, gin.H{"connections": out})
}

func (s *Server) ListPwchangeCandidates(c *gin.Context, params api.ListPwchangeCandidatesParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	cn, err := s.conns.Get(c.Request.Context(), params.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}
	targetDB, err := s.pools.DB(c.Request.Context(), &params.ConnectionId)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return
	}

	list, err := meta.ListCandidates(c.Request.Context(), targetDB, cn.SchemaName, map[string]struct{}{})
	if err != nil {
		if conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return
		}
		internalError(c, "pwchange candidates", err, "候補の取得に失敗しました")
		return
	}
	out := make([]api.SchemaTable, 0, len(list))
	for _, t := range list {
		out = append(out, api.SchemaTable{SchemaName: t.Schema, TableName: t.Table, HasPrimaryKey: t.HasPrimaryKey})
	}
	c.JSON(http.StatusOK, gin.H{"tables": out})
}

func (s *Server) PreviewPwchangeColumns(c *gin.Context, params api.PreviewPwchangeColumnsParams) {
	if !s.require(c, authz.ActionSettings, authz.LevelAdmin) {
		return
	}
	ins, ok := s.pwchangeIntrospect(c, params.ConnectionId, params.Schema, params.Table)
	if !ok {
		return
	}
	pk := ins.PrimaryKey
	if pk == nil {
		pk = []string{}
	}
	c.JSON(http.StatusOK, api.SchemaTablePreview{
		SchemaName: ins.Schema, TableName: ins.Table, PrimaryKey: pk,
		HasRowVersion: ins.RowVersionColumn != "", Columns: columnsDTO(ins.Columns),
	})
}

func (s *Server) pwchangeIntrospect(c *gin.Context, connID int, schema, table string) (*meta.Introspection, bool) {
	targetDB, err := s.pools.DB(c.Request.Context(), &connID)
	if err != nil {
		s.writeConnError(c, err, "接続の解決に失敗しました")
		return nil, false
	}
	ins, err := meta.Introspect(c.Request.Context(), targetDB, strings.TrimSpace(schema), strings.TrimSpace(table))
	if err != nil {
		if conn.IsUnreachable(err) {
			abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
			return nil, false
		}
		internalError(c, "pwchange introspect", err, "テーブル定義の取得に失敗しました")
		return nil, false
	}
	if ins == nil {
		abortErr(c, http.StatusNotFound, "not_found", fmt.Sprintf("テーブル %s.%s が存在しません", schema, table))
		return nil, false
	}
	return ins, true
}

func pwchangeFixedJSON(ins *meta.Introspection, fx *[]api.FixedColumn, idCol, pwCol string) (string, error) {
	if fx == nil {
		return "[]", nil
	}
	list := make([]meta.FixedColumn, 0, len(*fx))
	for _, f := range *fx {
		if strings.EqualFold(strings.TrimSpace(f.Name), idCol) || strings.EqualFold(strings.TrimSpace(f.Name), pwCol) {
			return "", fmt.Errorf("併せて更新する列に ID 列・パスワード列は指定できません")
		}
		mf := meta.FixedColumn{Name: f.Name, Kind: string(f.Kind), ApplyOn: string(f.ApplyOn)}
		if f.Value != nil {
			mf.Value = *f.Value
		}
		if mf.ApplyOn == "" {
			mf.ApplyOn = "update"
		}
		list = append(list, mf)
	}
	_, _, fxJSON, err := meta.NormalizeColumnModes(ins, nil, nil, list)
	if err != nil {
		return "", err
	}
	return fxJSON, nil
}

func validateLockSettings(maxFailures, lockMinutes int) string {
	if maxFailures < 1 || maxFailures > 100 {
		return "最大失敗回数は 1〜100 で指定してください"
	}
	if lockMinutes < 1 || lockMinutes > 1440 {
		return "ロック時間は 1〜1440 分で指定してください"
	}
	return ""
}

func recipeFromDTO(r api.PwchangeRecipe) pwchange.Recipe {
	return pwchange.Recipe{
		Algorithm:  pwchange.Algorithm(r.Algorithm),
		Template:   r.Template,
		Encoding:   pwchange.Encoding(r.Encoding),
		Output:     pwchange.Output(r.Output),
		Iterations: r.Iterations,
	}
}

func recipeDTO(r pwchange.Recipe) api.PwchangeRecipe {
	return api.PwchangeRecipe{
		Algorithm:  api.PwchangeRecipeAlgorithm(r.Algorithm),
		Template:   r.Template,
		Encoding:   api.PwchangeRecipeEncoding(r.Encoding),
		Output:     api.PwchangeRecipeOutput(r.Output),
		Iterations: r.Iterations,
	}
}

func policyFromDTO(p api.PwchangePolicy) pwchange.Policy {
	return pwchange.Policy{
		MinLen: p.MinLen, MaxLen: p.MaxLen, MinClasses: p.MinClasses,
		ASCIIOnly: p.AsciiOnly, ForbidSame: p.ForbidSame, ForbidIdentity: p.ForbidIdentity,
	}
}

func policyDTO(p pwchange.Policy) api.PwchangePolicy {
	return api.PwchangePolicy{
		MinLen: p.MinLen, MaxLen: p.MaxLen, MinClasses: p.MinClasses,
		AsciiOnly: p.ASCIIOnly, ForbidSame: p.ForbidSame, ForbidIdentity: p.ForbidIdentity,
	}
}

func targetDTO(t *pwchange.Target, recentFailures int) api.PwchangeTarget {
	fx := make([]api.FixedColumn, 0, len(t.FixedColumns))
	for _, f := range t.FixedColumns {
		d := api.FixedColumn{Name: f.Name, Kind: api.FixedColumnKind(f.Kind), ApplyOn: api.FixedColumnApplyOn(f.ApplyOn)}
		if f.Value != "" {
			d.Value = ptr(f.Value)
		}
		fx = append(fx, d)
	}
	out := api.PwchangeTarget{
		Id:                t.ID,
		ConnectionId:      t.ConnectionID,
		ConnectionName:    t.ConnectionName,
		ConnectionEnabled: ptr(t.ConnectionEnabled),
		SchemaName:        t.Schema,
		TableName:         t.Table,
		IdColumn:          t.IDColumn,
		PasswordColumn:    t.PasswordColumn,
		FixedColumns:      fx,
		Recipe:            recipeDTO(t.Recipe),
		Policy:            policyDTO(t.Policy),
		MaxFailures:       t.MaxFailures,
		LockMinutes:       t.LockMinutes,
		SaltSet:           t.SaltSet,
		Enabled:           t.Enabled,
		RecentFailures:    recentFailures,
	}
	if t.ConnectionColor != "" {
		out.ConnectionColor = ptr(t.ConnectionColor)
	}
	if t.NameColumn != "" {
		out.NameColumn = ptr(t.NameColumn)
	}
	if t.SaltSetAt != nil {
		at := t.SaltSetAt.UTC()
		out.SaltSetAt = &at
	}
	if t.SaltSetBy != "" {
		out.SaltSetBy = ptr(t.SaltSetBy)
	}
	if t.TestAccountID != "" {
		out.TestAccountId = ptr(t.TestAccountID)
	}
	return out
}

func (s *Server) writePwchangeError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, pwchange.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "変更先が存在しません")
	case errors.Is(err, pwchange.ErrConflict):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	case errors.Is(err, pwchange.ErrSaltUnset):
		abortErr(c, http.StatusConflict, "conflict", "ソルトが未設定のため照合できません")
	case errors.Is(err, pwchange.ErrColumn), errors.Is(err, pwchange.ErrRecipe):
		abortErr(c, http.StatusConflict, "conflict", err.Error())
	case errors.Is(err, conn.ErrNotFound):
		abortErr(c, http.StatusNotFound, "not_found", "接続が存在しません")
	case errors.Is(err, conn.ErrDisabled):
		abortErr(c, http.StatusConflict, "conflict", "この接続は無効化されています")
	case conn.IsUnreachable(err):
		abortErr(c, http.StatusBadGateway, "connection_unavailable", "接続先データベースに接続できません")
	default:
		internalError(c, "pwchange", err, fallback)
	}
}
