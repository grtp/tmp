package repo

import (
	"context"
	"fmt"

	"f-tool/internal/appdb"
	"f-tool/internal/auth/adguid"
)

// UserDashItem はユーザー個人の「現在のダッシュボード」を構成する項目
// (実体化コピー方式。2026-07-22 決定)。旧 app_user_dash(選択テンプレート
// + 並び順 + 非表示キーの差分管理)と旧 app_user_links(個人カード)を
// 統合し,1本のテーブルへ「今表示すべきカードそのもの」を position 順で
// 持つ。テンプレートへの参照は持たない(適用時にコピーするため独立)。
//
//   - kind=action: ActionID/ActionCode が対象機能を指す(表示は機能側の定義)
//   - kind=link  : Name/URL/Icon をこの行自身が持つ
//   - kind=table : ManagedTableID/ManagedTableName が管理対象テーブルを指す
type UserDashItem struct {
	ID               int
	Position         int
	Kind             string // "action" | "link" | "table"
	ActionID         int    // kind=action のみ(0 = なし)
	ActionCode       string // kind=action のみ(表示解決用)
	ManagedTableID   int    // kind=table のみ(0 = なし)
	ManagedTableName string // kind=table のみ(表示解決用)
	Name             string
	URL              string
	Icon             string
}

// ListUserDashItems はユーザーの現在のダッシュボード項目を position 順で返す
// (0件 = 空のダッシュボード。フロントはフォールバックせずそのまま空を表示する)。
func (r *Repo) ListUserDashItems(ctx context.Context, guid adguid.GUID) ([]UserDashItem, error) {
	rows, err := r.query(ctx, `
		SELECT i.id, i.position, i.kind,
		       COALESCE(i.action_id, 0), COALESCE(a.code, N''),
		       COALESCE(i.managed_table_id, 0), COALESCE(m.display_name, N''),
		       COALESCE(i.name, N''), COALESCE(i.url, N''), COALESCE(i.icon, N'')
		FROM dbo.ftool_app_user_dash_items i
		LEFT JOIN dbo.ftool_app_actions a ON a.id = i.action_id
		LEFT JOIN dbo.ftool_app_managed_tables m ON m.id = i.managed_table_id
		WHERE i.object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)
		ORDER BY i.position, i.id`, string(guid))
	if err != nil {
		return nil, fmt.Errorf("repo: list user dash items: %w", err)
	}
	defer rows.Close()

	out := []UserDashItem{}
	for rows.Next() {
		var it UserDashItem
		if err := rows.Scan(&it.ID, &it.Position, &it.Kind, &it.ActionID, &it.ActionCode,
			&it.ManagedTableID, &it.ManagedTableName, &it.Name, &it.URL, &it.Icon); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ReplaceUserDashItems は本人のダッシュボード項目を全置換する(配列順 = position)。
// テンプレート適用・並べ替え・カード追加/削除のいずれもこの全置換で実装する。
// actingUser は created_by/updated_by に使う(全置換なので毎回新規行になり,
// created_by も updated_by も同じ actor でよい)。
func (r *Repo) ReplaceUserDashItems(ctx context.Context, guid adguid.GUID, items []UserDashItem, actingUser string) ([]UserDashItem, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("repo: begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		appdb.Q(`DELETE FROM dbo.ftool_app_user_dash_items WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`),
		string(guid)); err != nil {
		return nil, fmt.Errorf("repo: clear items: %w", err)
	}
	for pos, it := range items {
		var actionID, tableID any
		if it.Kind == "action" {
			actionID = it.ActionID
		}
		if it.Kind == "table" {
			tableID = it.ManagedTableID
		}
		if _, err := tx.ExecContext(ctx, appdb.Q(`
			INSERT INTO dbo.ftool_app_user_dash_items
				(object_guid, position, kind, action_id, managed_table_id, name, url, icon, created_by, updated_by)
			VALUES (CAST(@p1 AS UNIQUEIDENTIFIER), @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p9)`),
			string(guid), pos, it.Kind, actionID, tableID,
			nullIfEmpty(it.Name), nullIfEmpty(it.URL), nullIfEmpty(it.Icon), actingUser); err != nil {
			// FK 違反 = 存在しない action_id / managed_table_id
			return nil, fmt.Errorf("repo: insert item %d: %w", pos, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("repo: commit: %w", err)
	}
	return r.ListUserDashItems(ctx, guid)
}
