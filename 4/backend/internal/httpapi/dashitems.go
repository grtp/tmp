// dashitems: ダッシュボード項目(機能カード / リンク / テーブルカード)の
// 入力検証。配布テンプレート(SetDashTemplateItems)と個人ダッシュボード
// (SetMyDashItems)で同じ形の検証が必要なため1か所にまとめる。
//
// 違いは「本人の権限内に限るか」だけ:
//   - 配布テンプレート: admin が全ユーザー向けに組むので権限検査はしない
//     (閲覧側でレンダリング時に除外される)
//   - 個人ダッシュボード: API 直叩きで権限外のカードを持てないよう検査する
package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	api "f-tool/gen/api"
	"f-tool/internal/authz"
	"f-tool/internal/repo"
)

// dashItemInput は生成型2つ(DashTemplateItemInput / UserDashItemInput)を
// 揃えた中間形。生成コードは触らずここで吸収する。
type dashItemInput struct {
	Kind           string
	ActionID       *int
	Name           *string
	URL            *string
	Icon           *string
	ManagedTableID *int
}

// dashItem は検証済みの1項目。repo の2つの型へはここから写す。
type dashItem struct {
	Kind           string
	ActionID       int
	ManagedTableID int
	Name           string
	URL            string
	Icon           string
}

// dashItemError は検証の失敗。HTTP へ写す情報だけを持つ
// (ハンドラは respondDashItemError に渡すだけでよい)。
type dashItemError struct {
	status int
	code   string
	msg    string
}

func (e *dashItemError) Error() string { return e.msg }

func invalidItem(msg string) *dashItemError {
	return &dashItemError{status: http.StatusBadRequest, code: "validation_failed", msg: msg}
}

func forbiddenItem(msg string) *dashItemError {
	return &dashItemError{status: http.StatusForbidden, code: "forbidden", msg: msg}
}

func respondDashItemError(c *gin.Context, err *dashItemError) {
	abortErr(c, err.status, err.code, err.msg)
}

func templateItemInputs(in []api.DashTemplateItemInput) []dashItemInput {
	out := make([]dashItemInput, 0, len(in))
	for _, i := range in {
		out = append(out, dashItemInput{
			Kind: string(i.Kind), ActionID: i.ActionId, Name: i.Name,
			URL: i.Url, Icon: i.Icon, ManagedTableID: i.ManagedTableId,
		})
	}
	return out
}

func userItemInputs(in []api.UserDashItemInput) []dashItemInput {
	out := make([]dashItemInput, 0, len(in))
	for _, i := range in {
		out = append(out, dashItemInput{
			Kind: string(i.Kind), ActionID: i.ActionId, Name: i.Name,
			URL: i.Url, Icon: i.Icon, ManagedTableID: i.ManagedTableId,
		})
	}
	return out
}

// parseDashItems は全項目を検証する。grants が非 nil なら本人の権限内に
// 限る(個人ダッシュボード用)。1件でも不正なら即座に返す。
func (s *Server) parseDashItems(ctx context.Context, ins []dashItemInput, grants *authz.Grants) ([]dashItem, *dashItemError) {
	items := make([]dashItem, 0, len(ins))
	for _, in := range ins {
		it, err := s.parseDashItem(ctx, in, grants)
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, nil
}

func (s *Server) parseDashItem(ctx context.Context, in dashItemInput, grants *authz.Grants) (dashItem, *dashItemError) {
	it := dashItem{Kind: in.Kind}
	switch in.Kind {
	case "action":
		if in.ActionID == nil {
			return it, invalidItem("action 項目には actionId が必要です")
		}
		it.ActionID = *in.ActionID
		if grants == nil {
			return it, nil // 配布テンプレートは存在検査のみ repo 側に委ねる
		}
		a, err := s.repo.GetAction(ctx, *in.ActionID)
		if err != nil || !a.Enabled {
			return it, invalidItem("指定された機能は存在しないか無効です")
		}
		if !grants.Allows(a.Code, authz.LevelUser) {
			return it, forbiddenItem("この機能の権限がありません")
		}
		it.ActionID = a.ID

	case "link":
		if in.Name == nil || strings.TrimSpace(*in.Name) == "" || in.URL == nil || !isHTTPURL(*in.URL) {
			return it, invalidItem("link 項目には name と http(s) の url が必要です")
		}
		it.Name = strings.TrimSpace(*in.Name)
		it.URL = *in.URL
		it.Icon = "open_in_new"
		if in.Icon != nil && *in.Icon != "" {
			it.Icon = *in.Icon
		}

	case "table":
		// テーブルカードは table-maint の権限が前提(押下先が 403 になるため)。
		if grants != nil && !grants.Allows(authz.ActionTableMaint, authz.LevelUser) {
			return it, forbiddenItem("テーブルメンテナンスの権限がありません")
		}
		if in.ManagedTableID == nil {
			return it, invalidItem("table 項目には managedTableId が必要です")
		}
		m, err := s.repo.GetManagedTable(ctx, *in.ManagedTableID)
		if err != nil || !m.Enabled {
			return it, invalidItem("指定されたテーブルは登録されていません")
		}
		it.ManagedTableID = m.ID

	default:
		return it, invalidItem("kind は action / link / table を指定してください")
	}
	return it, nil
}

func toTemplateItems(items []dashItem) []repo.DashTemplateItem {
	out := make([]repo.DashTemplateItem, 0, len(items))
	for _, it := range items {
		out = append(out, repo.DashTemplateItem{
			Kind: it.Kind, ActionID: it.ActionID, ManagedTableID: it.ManagedTableID,
			Name: it.Name, URL: it.URL, Icon: it.Icon,
		})
	}
	return out
}

func toUserItems(items []dashItem) []repo.UserDashItem {
	out := make([]repo.UserDashItem, 0, len(items))
	for _, it := range items {
		out = append(out, repo.UserDashItem{
			Kind: it.Kind, ActionID: it.ActionID, ManagedTableID: it.ManagedTableID,
			Name: it.Name, URL: it.URL, Icon: it.Icon,
		})
	}
	return out
}

// auditItemDetails は「何を並べたか」を監査に残すための要約。
func auditItemDetails(items []dashItem) []gin.H {
	out := make([]gin.H, 0, len(items))
	for _, it := range items {
		d := gin.H{"kind": it.Kind}
		if it.Kind == "action" {
			d["actionId"] = it.ActionID
		} else {
			d["name"] = it.Name
			d["url"] = it.URL
		}
		out = append(out, d)
	}
	return out
}

// isHTTPURL はリンク項目の URL 検証(スキーム限定)。
func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}
